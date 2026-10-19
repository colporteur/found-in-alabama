// Invoice pitch (COUPON-2): which site a package's buyer is most likely to
// come back to (FIA or TES), and a stock line for the bottom of the invoice
// ("theephemeralstate.com has over 4,300 postcards in stock today") with a
// link (QR code) to that shelf.
//
// Site: website orders know theirs. A marketplace order goes by its most
// expensive item's store categories — a category flagged Ephemeral State
// (or under one) means TES, anything else FIA. Codes work on either site;
// only the prefix follows the pitch.
//
// Stock line: start at that item's category (or its parent, when the
// category is set to "parent" on the Store categories page), count the
// in-stock items in it and its subcategories on that site, and climb to the
// parent until the count reaches the minimum (coupon settings); failing
// that, the whole store's count. Counts are live, so a reprint shows today's.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { tesQualifyingSet } from "@/lib/tes/selection";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export type Site = "fia" | "tes";
export const SITE_DOMAIN: Record<Site, string> = { fia: "foundinalabama.com", tes: "theephemeralstate.com" };

export type PitchCat = {
  categoryId: string;
  parentCategoryId: string | null;
  name: string;
  isEphemeralState: boolean;
  invoiceLabel: string | null;
  invoiceCountLevel: "self" | "parent";
  /** A catch-all (Other / New Arrivals / placeholder): never named on an invoice. */
  catchAll?: boolean;
};
export type StockItem = { cats: string[] };
export type PitchLine = { price: number | null; cats: string[] };

export type Pitch = {
  site: Site;
  count: number;
  /** The shelf counted; null = the whole store. */
  categoryId: string | null;
  text: string;
  url: string;
};

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** Pure: which site to pitch. */
export function pickSite(venue: string, lines: PitchLine[], tesSet: Set<string>): { site: Site; cat: string | null } {
  const best = [...lines].filter((l) => l.cats.length).sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0];
  if (venue === "tes" || venue === "fia") {
    const cat = best ? (venue === "tes" ? best.cats.find((c) => tesSet.has(c)) ?? null : best.cats[0]) : null;
    return { site: venue, cat };
  }
  if (!best) return { site: "fia", cat: null };
  const tesCat = best.cats.find((c) => tesSet.has(c));
  return tesCat ? { site: "tes", cat: tesCat } : { site: "fia", cat: best.cats[0] };
}

/** Pure: "over 4,300" style numbers — exact under 100, then rounded down. */
export function stockNumber(n: number): string {
  const step = n < 100 ? 1 : n < 1000 ? 10 : n < 10000 ? 100 : 1000;
  const floor = Math.floor(n / step) * step;
  return `${floor < n ? "over " : ""}${floor.toLocaleString("en-US")}`;
}

/** Pure: the counter for one site — in-stock items per category subtree. */
export function makeCounter(cats: PitchCat[], items: StockItem[], site: Site, tesSet: Set<string>) {
  const parent = new Map(cats.map((c) => [c.categoryId, c.parentCategoryId]));
  const pool = site === "tes" ? items.filter((i) => i.cats.some((c) => tesSet.has(c))) : items;
  // Every ancestor of each item's categories gets the item (once).
  const counts = new Map<string, number>();
  for (const it of pool) {
    const seen = new Set<string>();
    for (const c of it.cats) {
      let cur: string | null = c;
      let hops = 0;
      while (cur && hops < 20 && !seen.has(cur)) {
        seen.add(cur);
        cur = parent.get(cur) ?? null;
        hops++;
      }
    }
    for (const c of seen) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return { total: pool.length, of: (id: string) => counts.get(id) ?? 0 };
}

/** Pure: choose the shelf and write the line. */
export function choosePitch(opts: {
  site: Site;
  startCat: string | null;
  cats: PitchCat[];
  counter: { total: number; of: (id: string) => number };
  tesSet: Set<string>;
  min: number;
  slugOf: (site: Site, id: string) => string | null;
  code?: string | null;
}): Pitch {
  const { site, cats, counter, tesSet, min } = opts;
  const byId = new Map(cats.map((c) => [c.categoryId, c]));
  const onSite = (id: string) => site === "fia" || tesSet.has(id);
  let cur: string | null = opts.startCat && byId.has(opts.startCat) ? opts.startCat : null;
  if (cur && byId.get(cur)!.invoiceCountLevel === "parent") {
    const p = byId.get(cur)!.parentCategoryId;
    if (p && byId.has(p) && onSite(p)) cur = p;
  }
  let chosen: PitchCat | null = null;
  for (let hops = 0; cur && hops < 20 && onSite(cur); hops++) {
    if (!byId.get(cur)?.catchAll && counter.of(cur) >= min) {
      chosen = byId.get(cur)!;
      break;
    }
    cur = byId.get(cur)?.parentCategoryId ?? null;
  }
  const domain = SITE_DOMAIN[site];
  const q = opts.code ? `?code=${encodeURIComponent(opts.code)}` : "";
  if (!chosen) {
    const count = counter.total;
    return { site, count, categoryId: null, text: `${domain} has ${stockNumber(count)} items in stock today`, url: `https://${domain}/${q}` };
  }
  const count = counter.of(chosen.categoryId);
  const label = chosen.invoiceLabel?.trim();
  const text = label
    ? `${domain} has ${stockNumber(count)} ${label} in stock today`
    : `${domain} has ${stockNumber(count)} items in ${decode(chosen.name)} in stock today`;
  const slug = opts.slugOf(site, chosen.categoryId);
  return { site, count, categoryId: chosen.categoryId, text, url: `https://${domain}/${slug ? `shop/${slug}` : ""}${q}` };
}

// ─── loading ────────────────────────────────────────────────────────────────

export type PitchContext = {
  cats: PitchCat[];
  tesSet: Set<string>;
  counters: Record<Site, ReturnType<typeof makeCounter>>;
  slugOf: (site: Site, id: string) => string | null;
};

export async function loadPitchContext(): Promise<PitchContext> {
  const hasCols = (await rows(sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'ebay_store_categories' AND column_name IN ('invoice_label', 'invoice_count_level')`))[0];
  const withCols = Number(hasCols?.n ?? 0) === 2;
  const catRows = await rows(
    withCols
      ? sql`SELECT category_id, parent_category_id, name, is_ephemeral_state, is_other_bucket, invoice_label, invoice_count_level FROM ebay_store_categories`
      : sql`SELECT category_id, parent_category_id, name, is_ephemeral_state, is_other_bucket FROM ebay_store_categories`
  );
  const cats: PitchCat[] = catRows.map((c) => ({
    categoryId: String(c.category_id),
    parentCategoryId: c.parent_category_id ? String(c.parent_category_id) : null,
    name: String(c.name),
    isEphemeralState: c.is_ephemeral_state === true,
    invoiceLabel: (c.invoice_label as string | null) ?? null,
    invoiceCountLevel: c.invoice_count_level === "parent" ? "parent" : "self",
    catchAll: c.is_other_bucket === true || /^(other|new arrivals|placeholder category)$/i.test(decode(String(c.name))),
  }));
  const tesSet = tesQualifyingSet(cats);
  const itemRows = await rows(sql`
    SELECT store_category_1_id AS c1, store_category_2_id AS c2 FROM ebay_listings WHERE quantity > 0`);
  const items: StockItem[] = itemRows.map((r) => ({ cats: [r.c1, r.c2].filter(Boolean).map(String) }));
  // Shelf pages (only categories with their own in-stock items have one).
  const { getStorefrontCategories } = await import("@/lib/ebay/storefront");
  const [fiaShelves, tesShelves] = await Promise.all([
    getStorefrontCategories({ segment: "fia" }).catch(() => []),
    getStorefrontCategories({ segment: "tes" }).catch(() => []),
  ]);
  const slugMap = (list: Array<{ categoryId: string; categoryIds?: string[]; slug: string; isNewArrivals: boolean }>) => {
    const m = new Map<string, string>();
    for (const s of list) {
      if (s.isNewArrivals) continue;
      for (const id of [s.categoryId, ...(s.categoryIds ?? [])]) if (!m.has(id)) m.set(id, s.slug);
    }
    return m;
  };
  const slugs = { fia: slugMap(fiaShelves), tes: slugMap(tesShelves) };
  return {
    cats,
    tesSet,
    counters: { fia: makeCounter(cats, items, "fia", tesSet), tes: makeCounter(cats, items, "tes", tesSet) },
    slugOf: (site, id) => slugs[site].get(id) ?? null,
  };
}

/** Each package's lines with their store categories (from the eBay mirror). */
export async function orderLines(orderIds: string[]): Promise<Map<string, PitchLine[]>> {
  const out = new Map<string, PitchLine[]>();
  if (!orderIds.length) return out;
  const list = await rows(sql`
    SELECT l.order_id, l.price, el.store_category_1_id AS c1, el.store_category_2_id AS c2
    FROM ship_order_lines l
    LEFT JOIN sale_events e ON e.id = l.sale_event_id
    LEFT JOIN registry_items r ON r.id = l.registry_item_id
    LEFT JOIN ebay_listings el ON el.item_id = COALESCE(e.ebay_item_id, r.primary_ebay_item_id)
    WHERE l.order_id IN (${sql.join(orderIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  for (const r of list) {
    const k = String(r.order_id);
    const arr = out.get(k) ?? [];
    arr.push({ price: r.price == null ? null : Number(r.price), cats: [r.c1, r.c2].filter(Boolean).map(String) });
    out.set(k, arr);
  }
  return out;
}
