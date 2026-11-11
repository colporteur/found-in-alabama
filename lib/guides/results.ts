// "Your results" for an Expert Guide (Phase 5c): Todd's own sold and live
// items filed under a guide, kept apart from the guide's market survey.
//
// Price figures use TRUE sold prices only (a matched sale event or the sold
// venue listing). Older sales known only by their listed price are counted
// but never enter a median. Only confident links count unless asked.

import { db } from "@/db";
import { sql, type SQL } from "drizzle-orm";
import { listGuides } from "@/lib/enhance/guides";

type Row = Record<string, unknown>;
async function rows(q: SQL): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const num = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const int = (v: unknown) => (v == null ? 0 : Math.round(Number(v)));
const day = (v: unknown) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));

const localStart = (d: string) => sql`((${d}::date)::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`;
const localEnd = (d: string) => sql`(((${d}::date + 1))::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`;
const local = (col: SQL) => sql`(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')`;
export function todayCentral(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

const idList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

/** Linked sold items with a true sold price, a listed price and a known list date. */
function soldCte(linkWhere: SQL, from: string, to: string): SQL {
  return sql`
    SELECT r.id, r.title, r.bin_sku, COALESCE(r.sold_on_venue, '(unknown)') AS venue, r.sold_at,
           ${local(sql`r.sold_at`)} AS local_at, l.guide_id,
           COALESCE(se.price, vl.price) AS sold_price, it.price AS listed_price,
           LEAST(el.start_time, it.nifty_imported_at, it.captured_at) AS listed_since
    FROM item_guide_links l
    JOIN registry_items r ON r.id = l.registry_item_id
    LEFT JOIN items it ON it.id = r.nifty_item_ref
    LEFT JOIN ebay_listings el ON el.item_id = r.primary_ebay_item_id
    LEFT JOIN LATERAL (SELECT x.price FROM sale_events x
                       WHERE x.registry_item_id = r.id AND x.status = 'matched' AND x.price IS NOT NULL
                       ORDER BY x.sold_at DESC NULLS LAST LIMIT 1) se ON true
    LEFT JOIN LATERAL (SELECT v.price FROM venue_listings v
                       WHERE v.registry_item_id = r.id AND v.status = 'sold' AND v.venue = r.sold_on_venue AND v.price IS NOT NULL
                       LIMIT 1) vl ON true
    WHERE ${linkWhere} AND r.status = 'sold' AND r.sold_at IS NOT NULL
      AND r.sold_at >= ${localStart(from)} AND r.sold_at < ${localEnd(to)}`;
}

function liveCte(linkWhere: SQL): SQL {
  return sql`
    SELECT r.id, r.title, r.bin_sku, l.guide_id, COALESCE(el.price, it.price) AS price,
           COALESCE(LEAST(el.start_time, it.captured_at, it.nifty_imported_at, it.created_at), r.created_at) AS listed_since
    FROM item_guide_links l
    JOIN registry_items r ON r.id = l.registry_item_id
    LEFT JOIN items it ON it.id = r.nifty_item_ref
    LEFT JOIN ebay_listings el ON el.item_id = r.primary_ebay_item_id
    WHERE ${linkWhere} AND r.status = 'live'`;
}

const DAYS = sql`(extract(epoch FROM (sold_at - listed_since)) / 86400.0)`;
const AGE = sql`(extract(epoch FROM (now() - listed_since)) / 86400.0)`;

export type ResultsOpts = { from?: string | null; to?: string | null; includeChildren?: boolean; includeUnsure?: boolean; items?: number };

/** One guide's own results. */
export async function guideResults(guideId: string, opts: ResultsOpts = {}) {
  const lib = await listGuides();
  const guide = lib.find((g) => g.id === guideId);
  if (!guide) throw new Error(`No guide "${guideId}" in the library`);
  const children = lib.filter((g) => g.parent === guideId).map((g) => g.id);
  const ids = opts.includeChildren ? [guideId, ...children] : [guideId];
  const from = opts.from ?? todayCentral(-365);
  const to = opts.to ?? todayCentral();
  const n = Math.min(100, Math.max(0, opts.items ?? 25));
  const sure = opts.includeUnsure ? sql`true` : sql`l.confident = true`;
  const linkWhere = sql`l.guide_id IN (${idList(ids)}) AND ${sure}`;
  const S = soldCte(linkWhere, from, to);
  const L = liveCte(linkWhere);

  const [sold] = await rows(sql`
    WITH s AS (${S})
    SELECT count(*)::int AS sold, count(sold_price)::int AS with_sold_price,
           COALESCE(sum(sold_price), 0) AS revenue,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY sold_price) AS p25,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY sold_price) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY sold_price) AS p75,
           min(sold_price) AS low, max(sold_price) AS high,
           count(*) FILTER (WHERE sold_price >= 10)::int AS cleared_10,
           count(*) FILTER (WHERE sold_price >= 25)::int AS cleared_25,
           count(*) FILTER (WHERE listed_since < sold_at)::int AS days_known,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ${DAYS}) FILTER (WHERE listed_since < sold_at) AS days_median,
           count(*) FILTER (WHERE listed_since < sold_at AND ${DAYS} <= 30)::int AS within_30,
           count(*) FILTER (WHERE listed_since < sold_at AND ${DAYS} > 180)::int AS after_180,
           count(*) FILTER (WHERE sold_at >= now() - interval '90 days')::int AS sold_90
    FROM s`);
  const venues = await rows(sql`
    WITH s AS (${S})
    SELECT venue, count(*)::int AS sold, count(sold_price)::int AS priced,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY sold_price) AS median, COALESCE(sum(sold_price), 0) AS revenue
    FROM s GROUP BY venue ORDER BY 2 DESC`);
  const months = await rows(sql`
    WITH s AS (${S})
    SELECT to_char(local_at, 'YYYY-MM') AS month, count(*)::int AS sold, COALESCE(sum(sold_price), 0) AS revenue
    FROM s GROUP BY 1 ORDER BY 1`);
  const bands = await rows(sql`
    WITH s AS (${S})
    SELECT CASE WHEN sold_price < 10 THEN 1 WHEN sold_price < 25 THEN 2 WHEN sold_price < 50 THEN 3 ELSE 4 END AS band,
           count(*)::int AS sold
    FROM s WHERE sold_price IS NOT NULL GROUP BY 1 ORDER BY 1`);
  const BAND = ["", "under $10", "$10 to $24.99", "$25 to $49.99", "$50 and up"];
  const item = (r: Row) => ({
    id: String(r.id), title: String(r.title ?? ""), venue: String(r.venue), sold_on: day(r.local_at),
    price: num(r.sold_price ?? r.listed_price), price_kind: r.sold_price != null ? "sold" : r.listed_price != null ? "listed" : null,
    days_listed: r.days == null ? null : Math.round(Number(r.days)), bin_sku: (r.bin_sku as string | null) ?? null,
    guide: String(r.guide_id),
  });
  const pick = sql`id, title, bin_sku, venue, local_at, sold_price, listed_price, guide_id,
                   CASE WHEN listed_since < sold_at THEN ${DAYS} END AS days`;
  const recent = n ? await rows(sql`WITH s AS (${S}) SELECT ${pick} FROM s ORDER BY sold_at DESC LIMIT ${n}`) : [];
  const top = n ? await rows(sql`WITH s AS (${S}) SELECT ${pick} FROM s WHERE sold_price IS NOT NULL ORDER BY sold_price DESC LIMIT ${Math.min(n, 10)}`) : [];

  const [live] = await rows(sql`
    WITH v AS (${L})
    SELECT count(*)::int AS live, COALESCE(sum(price), 0) AS asking_total,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS asking_median,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ${AGE}) AS age_median,
           count(*) FILTER (WHERE ${AGE} > 180)::int AS over_180,
           count(*) FILTER (WHERE ${AGE} > 365)::int AS over_365
    FROM v`);
  const oldest = n ? await rows(sql`
    WITH v AS (${L}) SELECT id, title, bin_sku, price, guide_id, ${AGE} AS age FROM v ORDER BY listed_since ASC LIMIT ${Math.min(n, 10)}`) : [];
  const [unsure] = await rows(sql`
    SELECT count(*) FILTER (WHERE r.status = 'sold')::int AS sold, count(*) FILTER (WHERE r.status = 'live')::int AS live
    FROM item_guide_links l JOIN registry_items r ON r.id = l.registry_item_id
    WHERE l.guide_id IN (${idList(ids)}) AND l.confident = false AND r.status IN ('live', 'sold')`);

  const soldN = int(sold?.sold), priced = int(sold?.with_sold_price), liveN = int(live?.live), sold90 = int(sold?.sold_90);
  return {
    guide: { id: guide.id, name: guide.name, family: guide.family, childGuides: children },
    covers: opts.includeChildren && children.length ? "this guide and its child guides" : "this guide only",
    window: { from, to },
    sold: {
      count: soldN, withTrueSoldPrice: priced, countedAtListedPriceOnly: soldN - priced,
      revenue: num(sold?.revenue), median: num(sold?.median), p25: num(sold?.p25), p75: num(sold?.p75),
      low: num(sold?.low), high: num(sold?.high),
      clearedTenPct: priced ? Math.round((100 * int(sold?.cleared_10)) / priced) : null,
      clearedTwentyFivePct: priced ? Math.round((100 * int(sold?.cleared_25)) / priced) : null,
      daysToSell: {
        knownFor: int(sold?.days_known), median: sold?.days_median == null ? null : Math.round(Number(sold.days_median)),
        within30Days: int(sold?.within_30), after180Days: int(sold?.after_180),
        note: "Counted from the earliest listing date FIA knows, so real times can be longer.",
      },
      byVenue: venues.map((v) => ({ venue: String(v.venue), sold: int(v.sold), median: num(v.median), revenue: num(v.revenue) })),
      byMonth: months.map((m) => ({ month: String(m.month), sold: int(m.sold), revenue: num(m.revenue) })),
      byPrice: bands.map((b) => ({ band: BAND[int(b.band)] ?? String(b.band), sold: int(b.sold) })),
      top: top.map(item), recent: recent.map(item),
    },
    live: {
      count: liveN, askingTotal: num(live?.asking_total), askingMedian: num(live?.asking_median),
      medianDaysListed: live?.age_median == null ? null : Math.round(Number(live.age_median)),
      listedOver180Days: int(live?.over_180), listedOver365Days: int(live?.over_365),
      oldest: oldest.map((r) => ({ id: String(r.id), title: String(r.title ?? ""), price: num(r.price), days_listed: Math.round(Number(r.age ?? 0)), bin_sku: (r.bin_sku as string | null) ?? null, guide: String(r.guide_id) })),
    },
    last90Days: { sold: sold90, liveNow: liveN, soldShare: sold90 + liveN ? Math.round((100 * sold90) / (sold90 + liveN)) : null,
      note: "Sold in the last 90 days as a share of (sold + still live). Only meaningful when the window reaches today." },
    awaitingReview: { sold: int(unsure?.sold), live: int(unsure?.live) },
  };
}

/** Every guide in one table, plus how much of the inventory is filed at all. */
export async function guideResultsOverview(opts: { from?: string | null; to?: string | null } = {}) {
  const from = opts.from ?? todayCentral(-365);
  const to = opts.to ?? todayCentral();
  const lib = await listGuides();
  const byGuide = await rows(sql`
    WITH s AS (${soldCte(sql`l.guide_id IS NOT NULL AND l.confident = true`, from, to)}),
         v AS (${liveCte(sql`l.guide_id IS NOT NULL AND l.confident = true`)}),
         a AS (SELECT guide_id, count(*)::int AS sold, count(sold_price)::int AS priced, COALESCE(sum(sold_price), 0) AS revenue,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY sold_price) AS median,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY ${DAYS}) FILTER (WHERE listed_since < sold_at) AS days_median
               FROM s GROUP BY guide_id),
         b AS (SELECT guide_id, count(*)::int AS live, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS asking_median,
                      count(*) FILTER (WHERE ${AGE} > 180)::int AS over_180
               FROM v GROUP BY guide_id)
    SELECT COALESCE(a.guide_id, b.guide_id) AS guide_id, a.sold, a.priced, a.revenue, a.median, a.days_median,
           b.live, b.asking_median, b.over_180
    FROM a FULL JOIN b ON a.guide_id = b.guide_id`);
  const review = await rows(sql`
    SELECT l.guide_id, count(*)::int AS n FROM item_guide_links l JOIN registry_items r ON r.id = l.registry_item_id
    WHERE l.confident = false AND l.guide_id IS NOT NULL AND r.status IN ('live', 'sold') GROUP BY 1`);
  const [cover] = await rows(sql`
    SELECT count(*)::int AS items,
           count(l.registry_item_id)::int AS looked_at,
           count(*) FILTER (WHERE l.guide_id IS NOT NULL AND l.confident)::int AS filed,
           count(*) FILTER (WHERE l.guide_id IS NOT NULL AND NOT l.confident)::int AS awaiting_review,
           count(*) FILTER (WHERE l.registry_item_id IS NOT NULL AND l.guide_id IS NULL AND l.method = 'keyword')::int AS no_guide_word,
           count(*) FILTER (WHERE l.guide_id IS NULL AND l.method <> 'keyword')::int AS decided_no_guide,
           max(l.updated_at) AS last_linked
    FROM registry_items r LEFT JOIN item_guide_links l ON l.registry_item_id = r.id
    WHERE r.status IN ('live', 'sold')`);
  const rv = new Map(review.map((r) => [String(r.guide_id), int(r.n)]));
  const stat = new Map(byGuide.map((r) => [String(r.guide_id), r]));
  return {
    window: { from, to },
    coverage: {
      items: int(cover?.items), notYetLookedAt: int(cover?.items) - int(cover?.looked_at), filedUnderAGuide: int(cover?.filed),
      awaitingReview: int(cover?.awaiting_review), noGuideWordFound: int(cover?.no_guide_word), decidedNoGuide: int(cover?.decided_no_guide),
      lastLinked: cover?.last_linked == null ? null : cover.last_linked instanceof Date ? cover.last_linked.toISOString() : String(cover.last_linked),
    },
    guides: lib
      .filter((g) => stat.has(g.id) || rv.has(g.id))
      .map((g) => {
        const r = stat.get(g.id) ?? {};
        return {
          id: g.id, name: g.name, family: g.family,
          sold: int(r.sold), withTrueSoldPrice: int(r.priced), revenue: num(r.revenue), median: num(r.median),
          medianDaysToSell: r.days_median == null ? null : Math.round(Number(r.days_median)),
          live: int(r.live), askingMedian: num(r.asking_median), listedOver180Days: int(r.over_180),
          awaitingReview: rv.get(g.id) ?? 0,
        };
      })
      .sort((a, b) => b.sold - a.sold || b.live - a.live),
  };
}
