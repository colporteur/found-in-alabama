// Read-side numbers for /admin/sales (Phase SALES-1, shadow mode).

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;

async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => (v == null ? null : String(v));

export type SalesReport = {
  ready: boolean;
  days: number;
  firstSaleAt: string | null;
  lastRunAt: string | null;
  venues: {
    venue: string;
    sales: number;
    autoMatched: number;
    manual: number;
    review: number;
    duplicates: number;
    ignored: number;
  }[];
  delay: { source: string; sales: number; medianMinutes: number | null }[];
  legs: {
    venue: string;
    planned: number;
    done: number;
    stillLive: number;
    failedNifty: number;
    unverified: number;
    pending: number;
    medianMinutesToDone: number | null;
  }[];
  stillLiveAges: { over1h: number; over6h: number; over24h: number };
  niftyFailures: { venue: string; reason: string; count: number }[];
  niftyRecent: { venue: string; kind: string; count: number; last: string }[];
  missed: { venue: string; count: number }[];
  doubleSales: number;
  review: ReviewRow[];
  feed: FeedRow[];
};

export type ReviewRow = {
  id: string;
  venue: string;
  source: string;
  title: string | null;
  titleTruncated: boolean;
  price: number | null;
  soldAt: string | null;
  status: string;
  note: string | null;
  venueListingId: string | null;
  candidates: { id: string; title: string; status: string; ebayItemId: string | null; bin: string | null }[];
};

export type FeedRow = {
  id: string;
  venue: string;
  source: string;
  title: string | null;
  price: number | null;
  soldAt: string | null;
  detectedAt: string;
  status: string;
  matchMethod: string | null;
  flag: string | null;
  note: string | null;
  itemTitle: string | null;
  ebayItemId: string | null;
  legs: { venue: string; action: string; outcome: string; outcomeAt: string | null }[];
};

const EMPTY: SalesReport = {
  ready: false,
  days: 30,
  firstSaleAt: null,
  lastRunAt: null,
  venues: [],
  delay: [],
  legs: [],
  stillLiveAges: { over1h: 0, over6h: 0, over24h: 0 },
  niftyFailures: [],
  niftyRecent: [],
  missed: [],
  doubleSales: 0,
  review: [],
  feed: [],
};

export async function loadSalesReport(days = 30, feedSize = 50): Promise<SalesReport> {
  const [exists] = await rows(sql`SELECT to_regclass('public.sale_events') IS NOT NULL AS ok`);
  if (!exists?.ok) return { ...EMPTY, days };

  const since = sql`now() - make_interval(days => ${days})`;
  const at = sql`COALESCE(e.sold_at, e.detected_at)`;

  const [meta] = await rows(sql`
    SELECT min(${at}) AS first_sale, max(e.updated_at) AS last_run,
           count(*) FILTER (WHERE e.flag = 'double_sale' AND ${at} > ${since}) AS double_sales
    FROM sale_events e`);

  const venues = await rows(sql`
    SELECT e.venue,
           count(*) FILTER (WHERE e.status NOT IN ('duplicate', 'ignored')) AS sales,
           count(*) FILTER (WHERE e.status = 'matched' AND e.match_method <> 'manual') AS auto_matched,
           count(*) FILTER (WHERE e.status = 'matched' AND e.match_method = 'manual') AS manual,
           count(*) FILTER (WHERE e.status IN ('ambiguous', 'unmatched', 'pending')) AS review,
           count(*) FILTER (WHERE e.status = 'duplicate') AS duplicates,
           count(*) FILTER (WHERE e.status = 'ignored') AS ignored
    FROM sale_events e WHERE ${at} > ${since}
    GROUP BY e.venue ORDER BY count(*) DESC`);

  // Detection delay: sold → seen. Skips backfilled history (> 1 day late).
  const delay = await rows(sql`
    SELECT e.source, count(*) AS sales,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.detected_at - e.sold_at) / 60) AS median_min
    FROM sale_events e
    WHERE e.sold_at IS NOT NULL AND e.source <> 'ebay_events' AND ${at} > ${since}
      AND e.detected_at - e.sold_at BETWEEN interval '0' AND interval '1 day'
    GROUP BY e.source ORDER BY e.source`);

  const legs = await rows(sql`
    SELECT p.venue, count(*) AS planned,
           count(*) FILTER (WHERE p.outcome = 'done') AS done,
           count(*) FILTER (WHERE p.outcome = 'still_live') AS still_live,
           count(*) FILTER (WHERE p.outcome = 'failed_nifty') AS failed_nifty,
           count(*) FILTER (WHERE p.outcome = 'unverified') AS unverified,
           count(*) FILTER (WHERE p.outcome = 'pending') AS pending,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM p.outcome_at - COALESCE(e.sold_at, e.detected_at)) / 60)
             FILTER (WHERE p.outcome = 'done') AS median_done_min
    FROM delist_plans p JOIN sale_events e ON e.id = p.sale_event_id
    WHERE p.planned_at > ${since} AND p.outcome <> 'void'
    GROUP BY p.venue ORDER BY count(*) DESC`);

  const [ages] = await rows(sql`
    SELECT count(*) FILTER (WHERE p.planned_at < now() - interval '1 hour') AS h1,
           count(*) FILTER (WHERE p.planned_at < now() - interval '6 hours') AS h6,
           count(*) FILTER (WHERE p.planned_at < now() - interval '24 hours') AS h24
    FROM delist_plans p WHERE p.outcome = 'still_live' AND p.planned_at > ${since}`);

  const failures = await rows(sql`
    SELECT f->>'venue' AS venue, f->>'reason' AS reason, count(*) AS c
    FROM nifty_alerts a CROSS JOIN LATERAL jsonb_array_elements(a.failed) f
    WHERE a.received_at > ${since}
    GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 20`);

  const recent = await rows(sql`
    SELECT COALESCE(a.venue, f->>'venue') AS venue, a.kind, count(*) AS c, max(a.received_at) AS last
    FROM nifty_alerts a LEFT JOIN LATERAL jsonb_array_elements(a.failed) f ON true
    WHERE a.received_at > now() - interval '7 days'
    GROUP BY 1, 2 ORDER BY max(a.received_at) DESC`);

  // Sales Nifty recorded (captured as sold) that never showed up here, since
  // detection started. Only meaningful for venues whose signal is live.
  const missed = await rows(sql`
    SELECT i.sold_on_marketplace AS venue, count(*) AS c
    FROM items i JOIN registry_items r ON r.nifty_item_ref = i.id
    WHERE i.status = 'sold' AND i.sold_at > GREATEST(${since}, (SELECT min(detected_at) FROM sale_events))
      AND i.sold_on_marketplace IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sale_events e WHERE e.registry_item_id = r.id)
    GROUP BY 1 ORDER BY count(*) DESC`);

  const reviewRows = await rows(sql`
    SELECT e.id, e.venue, e.source, e.title, e.title_truncated, e.price, e.sold_at, e.status, e.note,
           e.venue_listing_id, e.candidates
    FROM sale_events e WHERE e.status IN ('ambiguous', 'unmatched')
    ORDER BY COALESCE(e.sold_at, e.detected_at) DESC LIMIT 100`);
  const candIds = Array.from(
    new Set(reviewRows.flatMap((r) => (Array.isArray(r.candidates) ? (r.candidates as string[]) : [])))
  );
  const candInfo = new Map<string, Row>();
  if (candIds.length > 0) {
    for (const c of await rows(sql`
      SELECT id, title, status, primary_ebay_item_id, bin_sku FROM registry_items
      WHERE id IN (${sql.join(candIds.map((id) => sql`${id}::uuid`), sql`, `)})`)) {
      candInfo.set(String(c.id), c);
    }
  }

  const feedRows = await rows(sql`
    SELECT e.id, e.venue, e.source, e.title, e.price, e.sold_at, e.detected_at, e.status, e.match_method,
           e.flag, e.note, r.title AS item_title, r.primary_ebay_item_id,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('venue', p.venue, 'action', p.planned_action,
                                                         'outcome', p.outcome, 'outcomeAt', p.outcome_at)
                                      ORDER BY p.venue)
                     FROM delist_plans p WHERE p.sale_event_id = e.id), '[]'::jsonb) AS legs
    FROM sale_events e LEFT JOIN registry_items r ON r.id = e.registry_item_id
    ORDER BY COALESCE(e.sold_at, e.detected_at) DESC LIMIT ${feedSize}`);

  return {
    ready: true,
    days,
    firstSaleAt: s(meta?.first_sale),
    lastRunAt: s(meta?.last_run),
    doubleSales: n(meta?.double_sales),
    venues: venues.map((v) => ({
      venue: String(v.venue),
      sales: n(v.sales),
      autoMatched: n(v.auto_matched),
      manual: n(v.manual),
      review: n(v.review),
      duplicates: n(v.duplicates),
      ignored: n(v.ignored),
    })),
    delay: delay.map((d) => ({
      source: String(d.source),
      sales: n(d.sales),
      medianMinutes: d.median_min == null ? null : Math.round(Number(d.median_min)),
    })),
    legs: legs.map((l) => ({
      venue: String(l.venue),
      planned: n(l.planned),
      done: n(l.done),
      stillLive: n(l.still_live),
      failedNifty: n(l.failed_nifty),
      unverified: n(l.unverified),
      pending: n(l.pending),
      medianMinutesToDone: l.median_done_min == null ? null : Math.round(Number(l.median_done_min)),
    })),
    stillLiveAges: { over1h: n(ages?.h1), over6h: n(ages?.h6), over24h: n(ages?.h24) },
    niftyFailures: failures.map((f) => ({ venue: String(f.venue), reason: String(f.reason), count: n(f.c) })),
    niftyRecent: recent
      .filter((r) => r.venue != null)
      .map((r) => ({ venue: String(r.venue), kind: String(r.kind), count: n(r.c), last: String(r.last) })),
    missed: missed.map((m) => ({ venue: String(m.venue), count: n(m.c) })),
    review: reviewRows.map((r) => ({
      id: String(r.id),
      venue: String(r.venue),
      source: String(r.source),
      title: s(r.title),
      titleTruncated: r.title_truncated === true,
      price: r.price == null ? null : Number(r.price),
      soldAt: s(r.sold_at),
      status: String(r.status),
      note: s(r.note),
      venueListingId: s(r.venue_listing_id),
      candidates: (Array.isArray(r.candidates) ? (r.candidates as string[]) : [])
        .map((id) => candInfo.get(id))
        .filter((c): c is Row => !!c)
        .map((c) => ({
          id: String(c.id),
          title: String(c.title),
          status: String(c.status),
          ebayItemId: s(c.primary_ebay_item_id),
          bin: s(c.bin_sku),
        })),
    })),
    feed: feedRows.map((f) => ({
      id: String(f.id),
      venue: String(f.venue),
      source: String(f.source),
      title: s(f.title),
      price: f.price == null ? null : Number(f.price),
      soldAt: s(f.sold_at),
      detectedAt: String(f.detected_at),
      status: String(f.status),
      matchMethod: s(f.match_method),
      flag: s(f.flag),
      note: s(f.note),
      itemTitle: s(f.item_title),
      ebayItemId: s(f.primary_ebay_item_id),
      legs: (Array.isArray(f.legs) ? f.legs : []) as FeedRow["legs"],
    })),
  };
}
