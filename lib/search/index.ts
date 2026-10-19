// Site search (SEARCH-1) — the search index. One row per in-stock listing in
// search_index (migration 0048): title, category names (with their parents)
// and the description as plain text, a weighted full-text vector (title >
// categories > description) and a meaning vector (embedding). Refreshed by
// the search-index cron every 15 minutes; only listings whose text changed
// are rebuilt or re-embedded. search_words is the vocabulary behind
// "Did you mean …?".

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { embedTexts, vectorLiteral } from "./embed";
import { DEFAULT_SYNONYMS, parseSynonyms } from "./query";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export async function searchReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.search_index') IS NOT NULL AS ok`);
  return !!r?.ok;
}

// ─── settings / status ──────────────────────────────────────────────────────

export async function synonymText(): Promise<string> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = 'searchSynonyms'`);
  const v = r?.value as { text?: unknown } | undefined;
  return typeof v?.text === "string" ? v.text : DEFAULT_SYNONYMS;
}

export async function synonymGroups(): Promise<string[][]> {
  return parseSynonyms(await synonymText());
}

export async function saveSynonyms(text: string): Promise<string[][]> {
  const clean = String(text ?? "").slice(0, 20000);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('searchSynonyms', ${JSON.stringify({ text: clean })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  return parseSynonyms(clean);
}

export type SearchStatus = {
  lastRefreshAt?: string;
  changed?: number;
  removed?: number;
  lastEmbedAt?: string;
  embedded?: number;
  embedError?: string | null;
};

async function saveStatus(patch: SearchStatus): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('searchStatus', ${JSON.stringify(patch)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = app_settings.value || EXCLUDED.value, updated_at = now()`);
}

export async function searchStatus(): Promise<SearchStatus & { indexed: number; withMeaning: number; inStock: number; words: number }> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = 'searchStatus'`);
  const [c] = await rows(sql`
    SELECT (SELECT count(*)::int FROM search_index) AS indexed,
           (SELECT count(*)::int FROM search_index WHERE embedding IS NOT NULL AND embedded_hash = text_hash) AS meaning,
           (SELECT count(*)::int FROM ebay_listings WHERE quantity > 0) AS in_stock,
           (SELECT count(*)::int FROM search_words) AS words`);
  return {
    ...((r?.value ?? {}) as SearchStatus),
    indexed: Number(c?.indexed ?? 0),
    withMeaning: Number(c?.meaning ?? 0),
    inStock: Number(c?.in_stock ?? 0),
    words: Number(c?.words ?? 0),
  };
}

// ─── refresh ────────────────────────────────────────────────────────────────

/** Rebuild the rows whose text changed, drop listings no longer in stock,
 *  and refresh the vocabulary. Pure SQL — a few seconds for the catalog. */
export async function refreshSearchIndex(): Promise<{ changed: number; removed: number }> {
  const changed = await rows(sql`
    WITH RECURSIVE anc AS (
      SELECT category_id AS leaf, category_id AS cid, 0 AS depth FROM ebay_store_categories
      UNION ALL
      SELECT a.leaf, c.parent_category_id, a.depth + 1
      FROM anc a JOIN ebay_store_categories c ON c.category_id = a.cid
      WHERE c.parent_category_id IS NOT NULL AND a.depth < 6
    ),
    catnames AS (
      SELECT a.leaf, string_agg(DISTINCT replace(c.name, '&amp;', '&'), ' ') AS names
      FROM anc a JOIN ebay_store_categories c ON c.category_id = a.cid
      WHERE NOT c.is_other_bucket AND c.name !~* '^(other|new arrivals|placeholder category)$'
      GROUP BY a.leaf
    ),
    src AS (
      SELECT e.item_id,
             regexp_replace(replace(replace(e.title, '&amp;', '&'), '&quot;', '"'), '&(apos|#0?39);', '''', 'g') AS title,
             trim(coalesce(n1.names, '') || ' ' || coalesce(n2.names, '')) AS cats,
             left(regexp_replace(regexp_replace(regexp_replace(replace(coalesce(e.description, ''), '&amp;', '&'), '<[^>]*>', ' ', 'g'), '&[a-z0-9#]+;', ' ', 'gi'), '\\s+', ' ', 'g'), 4000) AS body
      FROM ebay_listings e
      LEFT JOIN catnames n1 ON n1.leaf = e.store_category_1_id
      LEFT JOIN catnames n2 ON n2.leaf = e.store_category_2_id
      WHERE e.quantity > 0
    ),
    hashed AS (
      SELECT s.*, md5(s.title || '|' || s.cats || '|' || s.body) AS h
      FROM src s LEFT JOIN search_index si ON si.item_id = s.item_id
      WHERE si.text_hash IS DISTINCT FROM md5(s.title || '|' || s.cats || '|' || s.body)
    )
    INSERT INTO search_index (item_id, title, cats, body, tsv, text_hash, updated_at)
    SELECT item_id, title, cats, body,
           setweight(to_tsvector('english', unaccent(title)), 'A') ||
           setweight(to_tsvector('english', unaccent(cats)), 'B') ||
           setweight(to_tsvector('english', unaccent(body)), 'C'),
           h, now()
    FROM hashed
    ON CONFLICT (item_id) DO UPDATE SET title = EXCLUDED.title, cats = EXCLUDED.cats, body = EXCLUDED.body,
      tsv = EXCLUDED.tsv, text_hash = EXCLUDED.text_hash, updated_at = now()
    RETURNING item_id`);
  const removed = await rows(sql`
    DELETE FROM search_index s
    WHERE NOT EXISTS (SELECT 1 FROM ebay_listings e WHERE e.item_id = s.item_id AND e.quantity > 0)
    RETURNING item_id`);
  const [w] = await rows(sql`SELECT count(*)::int AS n FROM search_words`);
  if (changed.length || removed.length || !Number(w?.n)) await refreshWords();
  await saveStatus({ lastRefreshAt: new Date().toISOString(), changed: changed.length, removed: removed.length });
  return { changed: changed.length, removed: removed.length };
}

async function refreshWords(): Promise<void> {
  await db.execute(sql`
    INSERT INTO search_words (word, ndoc)
    SELECT word, ndoc FROM ts_stat($q$SELECT to_tsvector('simple', unaccent(title || ' ' || cats)) FROM search_index$q$)
    WHERE length(word) BETWEEN 3 AND 30 AND word ~ '^[a-z]+$'
    ON CONFLICT (word) DO UPDATE SET ndoc = EXCLUDED.ndoc`);
  await db.execute(sql`
    DELETE FROM search_words w WHERE NOT EXISTS (
      SELECT 1 FROM ts_stat($q$SELECT to_tsvector('simple', unaccent(title || ' ' || cats)) FROM search_index$q$) t WHERE t.word = w.word)`);
}

/** Embed listings whose text changed since their last embedding, within a
 *  time budget. Returns how many were done; records any gateway error so
 *  /admin/search can show it (keyword search works regardless). */
export async function embedPending(budgetMs = 45_000, batch = 96): Promise<{ embedded: number; pending: number; error: string | null }> {
  const started = Date.now();
  let embedded = 0;
  let error: string | null = null;
  while (Date.now() - started < budgetMs) {
    const list = await rows(sql`
      SELECT item_id, title, cats, left(body, 700) AS body, text_hash FROM search_index
      WHERE embedded_hash IS DISTINCT FROM text_hash ORDER BY updated_at DESC LIMIT ${batch}`);
    if (!list.length) break;
    let vecs: number[][];
    try {
      vecs = await embedTexts(list.map((r) => `${r.title}\nCategories: ${r.cats}\n${r.body}`.slice(0, 2000)));
    } catch (err) {
      error = (err as Error).message;
      break;
    }
    await db.execute(sql`
      UPDATE search_index s SET embedding = v.e::vector, embedded_hash = v.h
      FROM (VALUES ${sql.join(
        list.map((r, i) => sql`(${String(r.item_id)}, ${vectorLiteral(vecs[i])}, ${String(r.text_hash)})`),
        sql`, `
      )}) AS v(id, e, h)
      WHERE s.item_id = v.id`);
    embedded += list.length;
  }
  const [p] = await rows(sql`SELECT count(*)::int AS n FROM search_index WHERE embedded_hash IS DISTINCT FROM text_hash`);
  await saveStatus({ lastEmbedAt: new Date().toISOString(), embedded, embedError: error });
  return { embedded, pending: Number(p?.n ?? 0), error };
}
