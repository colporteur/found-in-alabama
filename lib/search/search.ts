// Site search (SEARCH-1) — the engine behind /search on both storefronts
// and the header's suggestions.
//
// A search runs three ways at once and merges them:
//   1. words   — full text over title (strongest), category names and the
//                description, with stemming (postcards = postcard), accents
//                ignored, quoted phrases, -exclusions and Todd's synonyms;
//   2. typos   — fuzzy title matching (Birmingam → Birmingham), used when
//                the words find little;
//   3. meaning — embeddings ("old train stuff" → railroadiana), shown as
//                "Related" after the real matches (or instead of them when
//                nothing matched).
// Results are limited to the site's own items (TES = Ephemeral State
// categories), filtered by category (with subcategories) and price, and
// sorted by best match, newest or price.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getStorefrontCategories, hydrateStorefrontItems, type StorefrontItem } from "@/lib/ebay/storefront";
import { tesQualifyingSet } from "@/lib/tes/selection";
import { embedQuery, vectorLiteral } from "./embed";
import { synonymGroups } from "./index";
import { didYouMean, parseQuery, prefixTsquery, type ParsedQuery } from "./query";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export type Site = "fia" | "tes";
export type SearchSort = "best" | "newest" | "price-asc" | "price-desc";
export type SearchParams = {
  q: string;
  site: Site;
  categoryId?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  sort?: SearchSort;
  page?: number;
  perPage?: number;
};
export type Facet = { categoryId: string; name: string; slug: string | null; count: number };
export type SearchResult = {
  items: StorefrontItem[];
  total: number;
  page: number;
  pages: number;
  /** Items found by meaning only (shown as "Related"). */
  related: StorefrontItem[];
  facets: Facet[];
  didYouMean: string | null;
  /** True when the results came from typo matching only. */
  fuzzyOnly: boolean;
};

type Cand = { id: string; score: number; cat1: string | null; cat2: string | null; price: number | null; start: number };

const MAX_CANDIDATES = 3000;
const SEMANTIC_MIN = 0.3;

/** Category tree helpers for one site. */
async function siteCats(site: Site) {
  const all = await rows(sql`SELECT category_id, parent_category_id, name, is_ephemeral_state FROM ebay_store_categories`);
  const cats = all.map((c) => ({
    categoryId: String(c.category_id),
    parentCategoryId: c.parent_category_id ? String(c.parent_category_id) : null,
    name: String(c.name).replace(/&amp;/g, "&"),
    isEphemeralState: c.is_ephemeral_state === true,
  }));
  const tesSet = tesQualifyingSet(cats);
  const children = new Map<string, string[]>();
  for (const c of cats) if (c.parentCategoryId) children.set(c.parentCategoryId, [...(children.get(c.parentCategoryId) ?? []), c.categoryId]);
  const subtree = (id: string) => {
    const out = new Set<string>([id]);
    const stack = [id];
    while (stack.length) for (const k of children.get(stack.pop()!) ?? []) if (!out.has(k)) (out.add(k), stack.push(k));
    return out;
  };
  const shelves = await getStorefrontCategories({ segment: site }).catch(() => []);
  const slug = new Map<string, string>();
  for (const s of shelves) for (const id of [s.categoryId, ...(s.categoryIds ?? [])]) if (!slug.has(id)) slug.set(id, s.slug);
  const shelfName = new Map(shelves.map((s) => [s.categoryId, s.name]));
  return { cats, tesSet, subtree, slug, nameOf: (id: string) => shelfName.get(id) ?? cats.find((c) => c.categoryId === id)?.name ?? id };
}

function tsqueryFor(p: ParsedQuery) {
  if (!p.groups.length) return null;
  const groupSql = p.groups.map(
    (alts) => sql`(${sql.join(alts.map((a) => sql`phraseto_tsquery('english', unaccent(${a}))`), sql` || `)})`
  );
  let q = sql.join(groupSql, sql` && `);
  if (p.exclude.length) {
    q = sql`(${q}) && !!(${sql.join(p.exclude.map((x) => sql`phraseto_tsquery('english', unaccent(${x}))`), sql` || `)})`;
  }
  return q;
}

function toCand(r: Row, score: number): Cand {
  return {
    id: String(r.item_id),
    score,
    cat1: (r.cat1 as string | null) ?? null,
    cat2: (r.cat2 as string | null) ?? null,
    price: r.price == null ? null : Number(r.price),
    start: r.start_time ? new Date(String(r.start_time)).getTime() : 0,
  };
}

export async function searchItems(params: SearchParams): Promise<SearchResult> {
  const perPage = Math.min(96, Math.max(12, params.perPage ?? 48));
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const sort: SearchSort = params.sort ?? "best";
  const synonyms = await synonymGroups().catch(() => []);
  const parsed = parseQuery(params.q, synonyms);
  const site = await siteCats(params.site);

  // Which listings this view may show.
  const catFilter = params.categoryId ? site.subtree(params.categoryId) : null;
  const cats = (c: Cand) => [c.cat1, c.cat2].filter(Boolean) as string[];
  const inCategory = (c: Cand) => !catFilter || cats(c).some((x) => catFilter.has(x));
  const allowedBase = (c: Cand) => {
    const cs = cats(c);
    if (params.site === "tes" && !cs.some((x) => site.tesSet.has(x))) return false;
    if (params.minPrice != null && (c.price == null || c.price < params.minPrice)) return false;
    if (params.maxPrice != null && (c.price == null || c.price > params.maxPrice)) return false;
    return true;
  };
  const allowed = (c: Cand) => allowedBase(c) && inCategory(c);

  // 1. words
  const tq = tsqueryFor(parsed);
  let found: Cand[] = [];
  if (tq) {
    const list = await rows(sql`
      WITH q AS (SELECT ${tq} AS tq)
      SELECT s.item_id, e.store_category_1_id AS cat1, e.store_category_2_id AS cat2, e.price, e.start_time,
             ts_rank_cd('{0.1, 0.25, 0.5, 1.0}', s.tsv, q.tq, 32) + 0.3 * word_similarity(${parsed.text}, s.title) AS score
      FROM search_index s CROSS JOIN q
      JOIN ebay_listings e ON e.item_id = s.item_id AND e.quantity > 0
      WHERE s.tsv @@ q.tq
      ORDER BY score DESC LIMIT ${MAX_CANDIDATES}`);
    found = list.map((r) => toCand(r, Number(r.score)));
  } else if (params.categoryId || params.minPrice != null || params.maxPrice != null) {
    // No words: browse by category / price.
    const list = await rows(sql`
      SELECT e.item_id, e.store_category_1_id AS cat1, e.store_category_2_id AS cat2, e.price, e.start_time
      FROM ebay_listings e WHERE e.quantity > 0`);
    found = list.map((r) => toCand(r, 0));
  }
  found = found.filter(allowedBase);

  // 2. typos — only when the words found little.
  let fuzzyOnly = false;
  if (found.length < 5 && parsed.text.length >= 3) {
    const have = new Set(found.map((c) => c.id));
    const fuzzy = await rows(sql`
      SELECT s.item_id, e.store_category_1_id AS cat1, e.store_category_2_id AS cat2, e.price, e.start_time,
             word_similarity(${parsed.text}, s.title) AS score
      FROM search_index s JOIN ebay_listings e ON e.item_id = s.item_id AND e.quantity > 0
      WHERE ${parsed.text} <% s.title
      ORDER BY score DESC LIMIT 300`);
    const extra = fuzzy.map((r) => toCand(r, Number(r.score) * 0.5)).filter((c) => !have.has(c.id) && allowedBase(c));
    if (!found.length && extra.length) fuzzyOnly = true;
    found = [...found, ...extra];
  }

  // 3. meaning (best effort: off until the gateway has embeddings).
  let related: Cand[] = [];
  const semScore = new Map<string, number>();
  if (parsed.text.length >= 3) {
    try {
      const v = await embedQuery(parsed.text);
      if (v) {
        const sem = await rows(sql`
          SELECT s.item_id, e.store_category_1_id AS cat1, e.store_category_2_id AS cat2, e.price, e.start_time,
                 1 - (s.embedding <=> ${vectorLiteral(v)}::vector) AS sim
          FROM search_index s JOIN ebay_listings e ON e.item_id = s.item_id AND e.quantity > 0
          WHERE s.embedding IS NOT NULL
          ORDER BY s.embedding <=> ${vectorLiteral(v)}::vector LIMIT 40`);
        const best = sem.length ? Number(sem[0].sim) : 0;
        const floor = Math.max(SEMANTIC_MIN, best - 0.15);
        for (const r of sem) if (Number(r.sim) >= floor) semScore.set(String(r.item_id), Number(r.sim));
        const have = new Set(found.map((c) => c.id));
        related = sem
          .filter((r) => Number(r.sim) >= floor && !have.has(String(r.item_id)))
          .map((r) => toCand(r, Number(r.sim)))
          .filter(allowed)
          .slice(0, 12);
      }
    } catch {
      // keyword search stands on its own
    }
  }
  // Meaning nudges the order of real matches a little.
  for (const c of found) c.score += 0.2 * (semScore.get(c.id) ?? 0);

  // Facets: the shelves the matches sit on (before the category filter, so
  // the shopper can switch between them).
  const facetCount = new Map<string, number>();
  for (const c of found) for (const id of new Set(cats(c))) facetCount.set(id, (facetCount.get(id) ?? 0) + 1);
  found = found.filter(inCategory);
  const facets: Facet[] = [...facetCount.entries()]
    .filter(([id]) => params.site === "fia" || site.tesSet.has(id))
    .map(([id, count]) => ({ categoryId: id, name: site.nameOf(id), slug: site.slug.get(id) ?? null, count }))
    .filter((f) => !/^(other|new arrivals|placeholder category)$/i.test(f.name))
    .sort((a, b) => b.count - a.count)
    .slice(0, 14);

  const sorted = [...found].sort((a, b) =>
    sort === "newest"
      ? b.start - a.start
      : sort === "price-asc"
        ? (a.price ?? Infinity) - (b.price ?? Infinity)
        : sort === "price-desc"
          ? (b.price ?? -Infinity) - (a.price ?? -Infinity)
          : b.score - a.score
  );
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const pageIds = sorted.slice((page - 1) * perPage, page * perPage).map((c) => c.id);

  // Did you mean — when little or nothing matched by words.
  let suggestion: string | null = null;
  if (found.length < 5 && parsed.words.length) {
    const fixes = new Map<string, string>();
    for (const w of parsed.words.slice(0, 6)) {
      if (w.length < 4) continue;
      const [exact] = await rows(sql`SELECT 1 AS ok FROM search_words WHERE word = ${w}`);
      if (exact) continue;
      const [best] = await rows(sql`
        SELECT word FROM search_words WHERE word % ${w}
        ORDER BY similarity(word, ${w}) DESC, ndoc DESC LIMIT 1`);
      if (best) fixes.set(w, String(best.word));
    }
    suggestion = didYouMean(params.q, fixes);
  }

  const [items, relatedItems] = await Promise.all([
    hydrateStorefrontItems(pageIds),
    page === 1 ? hydrateStorefrontItems(related.map((c) => c.id)) : Promise.resolve([]),
  ]);
  return { items, total, page, pages, related: relatedItems, facets, didYouMean: suggestion, fuzzyOnly };
}

// ─── suggestions as you type ────────────────────────────────────────────────

export type Suggestion = {
  categories: Array<{ name: string; slug: string; count: number }>;
  items: Array<{ itemId: string; title: string; price: string | null; imageUrl: string | null }>;
};

export async function suggest(q: string, site: Site): Promise<Suggestion> {
  const text = q.trim().slice(0, 80);
  if (text.length < 2) return { categories: [], items: [] };
  const lower = text.toLowerCase();
  const shelves = await getStorefrontCategories({ segment: site }).catch(() => []);
  const categories = shelves
    .filter((s) => !s.isNewArrivals && s.name.toLowerCase().includes(lower))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((s) => ({ name: s.name, slug: s.slug, count: s.count }));

  const tes = site === "tes" ? (await siteCats("tes")).tesSet : null;
  const onSite = (r: Row) => !tes || [r.cat1, r.cat2].some((c) => c && tes.has(String(c)));
  const pq = prefixTsquery(text);
  let list: Row[] = [];
  if (pq) {
    list = await rows(sql`
      SELECT s.item_id, s.title, e.price, e.primary_image_url AS image, e.store_category_1_id AS cat1, e.store_category_2_id AS cat2
      FROM search_index s JOIN ebay_listings e ON e.item_id = s.item_id AND e.quantity > 0
      WHERE s.tsv @@ to_tsquery('english', ${pq})
      ORDER BY ts_rank_cd('{0.1, 0.25, 0.5, 1.0}', s.tsv, to_tsquery('english', ${pq}), 32) DESC, e.start_time DESC
      LIMIT 40`);
  }
  if (list.filter(onSite).length < 3 && text.length >= 4) {
    const fuzzy = await rows(sql`
      SELECT s.item_id, s.title, e.price, e.primary_image_url AS image, e.store_category_1_id AS cat1, e.store_category_2_id AS cat2
      FROM search_index s JOIN ebay_listings e ON e.item_id = s.item_id AND e.quantity > 0
      WHERE ${text} <% s.title
      ORDER BY word_similarity(${text}, s.title) DESC LIMIT 20`);
    const have = new Set(list.map((r) => String(r.item_id)));
    list = [...list, ...fuzzy.filter((r) => !have.has(String(r.item_id)))];
  }
  const items = list
    .filter(onSite)
    .slice(0, 6)
    .map((r) => ({
      itemId: String(r.item_id),
      title: String(r.title),
      price: r.price == null ? null : String(r.price),
      imageUrl: (r.image as string | null) ?? null,
    }));
  return { categories, items };
}

// ─── the search log ─────────────────────────────────────────────────────────

export async function logSearch(site: Site, q: string, results: number): Promise<void> {
  const text = q.trim().slice(0, 200);
  if (!text) return;
  await db.execute(sql`INSERT INTO search_log (site, q, results) VALUES (${site}, ${text}, ${results})`).catch(() => {});
}

export async function searchLogSummary(days = 30) {
  const top = await rows(sql`
    SELECT lower(q) AS q, count(*)::int AS n, max(results)::int AS results, max(created_at) AS last
    FROM search_log WHERE created_at > now() - make_interval(days => ${days})
    GROUP BY lower(q) ORDER BY n DESC, last DESC LIMIT 40`);
  const zero = await rows(sql`
    SELECT lower(q) AS q, count(*)::int AS n, max(created_at) AS last, string_agg(DISTINCT site, ',') AS sites
    FROM search_log WHERE created_at > now() - make_interval(days => ${days}) AND results = 0
    GROUP BY lower(q) ORDER BY n DESC, last DESC LIMIT 40`);
  const [t] = await rows(sql`
    SELECT count(*)::int AS n, count(*) FILTER (WHERE results = 0)::int AS zero,
           count(*) FILTER (WHERE site = 'tes')::int AS tes
    FROM search_log WHERE created_at > now() - make_interval(days => ${days})`);
  return {
    totals: { searches: Number(t?.n ?? 0), zero: Number(t?.zero ?? 0), tes: Number(t?.tes ?? 0) },
    top: top.map((r) => ({ q: String(r.q), n: Number(r.n), results: Number(r.results), last: String(r.last) })),
    zero: zero.map((r) => ({ q: String(r.q), n: Number(r.n), last: String(r.last), sites: String(r.sites ?? "") })),
  };
}
