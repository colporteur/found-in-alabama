// Invoice custom searches (COUPON-2c), server side: live counts, recent
// searches and suggested place searches for the Ship page and invoices.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { countSearch, searchContext, type SearchContext } from "@/lib/search/search";
import { searchReady } from "@/lib/search/index";
import { cleanPitchSearch, placeCandidates, placeQuery, searchKey, type PitchSearch } from "./invoice-search";
import type { Site } from "./invoice-pitch";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

/** Counts many searches with one loaded context per site. */
export function searchCounter() {
  const ctx: Partial<Record<Site, Promise<SearchContext>>> = {};
  const cache = new Map<string, Promise<number>>();
  return (ps: PitchSearch): Promise<number> => {
    const key = searchKey({ ...ps, label: null });
    let p = cache.get(key);
    if (!p) {
      ctx[ps.site] ??= searchContext(ps.site);
      p = ctx[ps.site]!.then((c) =>
        countSearch({ q: ps.q, site: ps.site, categoryId: ps.category ?? null, minPrice: ps.min ?? null, maxPrice: ps.max ?? null }, c)
      ).catch(() => 0);
      cache.set(key, p);
    }
    return p;
  };
}

/** Searches Todd used on recent packages (newest first, no repeats). */
export async function recentSearches(limit = 8): Promise<PitchSearch[]> {
  const list = await rows(sql`
    SELECT pitch_search FROM ship_orders WHERE pitch_search IS NOT NULL ORDER BY updated_at DESC LIMIT 60`).catch(() => []);
  const out: PitchSearch[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const ps = cleanPitchSearch(r.pitch_search);
    if (!ps) continue;
    const k = searchKey(ps);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ps);
    if (out.length >= limit) break;
  }
  return out;
}

export type CountedSearch = { search: PitchSearch; count: number };

/** For the Ship page: per package, suggested place searches (with counts,
 *  at least `minCount`), plus the recent searches with counts. */
export async function searchChoices(
  orders: Array<{ id: string; titles: string[]; site: Site; pitchSearch?: PitchSearch | null }>,
  minCount = 3
): Promise<{ suggested: Record<string, CountedSearch[]>; current: Record<string, CountedSearch>; recent: CountedSearch[] }> {
  const suggested: Record<string, CountedSearch[]> = {};
  const current: Record<string, CountedSearch> = {};
  if (!orders.length || !(await searchReady().catch(() => false))) return { suggested, current, recent: [] };
  const count = searchCounter();
  const recentList = await recentSearches();
  await Promise.all(
    orders.map(async (o) => {
      const places = placeCandidates(o.titles, 3);
      const found = await Promise.all(places.map(async (p) => ({ search: { site: o.site, q: placeQuery(p) }, count: await count({ site: o.site, q: placeQuery(p) }) })));
      suggested[o.id] = found.filter((f) => f.count >= minCount);
      if (o.pitchSearch) current[o.id] = { search: o.pitchSearch, count: await count(o.pitchSearch) };
    })
  );
  const recent = await Promise.all(recentList.map(async (s) => ({ search: s, count: await count(s) })));
  return { suggested, current, recent };
}
