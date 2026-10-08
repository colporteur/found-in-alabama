// Read-side numbers for /admin/registry (Phase REG-1).

import { db } from "@/db";
import { sql } from "drizzle-orm";

export type RegistryReport = {
  ready: boolean;
  totals: { total: number; live: number; sold: number; other: number };
  forSaleOnEbay: number;
  withNifty: number;
  coverage: { venue: string; linked: number; live: number }[];
  venueStatus: { venue: string; state: string; note: string | null; checkedAt: string }[];
  review: { kind: string; open: number; dismissed: number }[];
  reviewSamples: Record<
    string,
    { id: string; registryItemId: string | null; detail: Record<string, unknown> }[]
  >;
  lastUpdated: string | null;
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export async function loadRegistryReport(sampleSize = 25): Promise<RegistryReport> {
  // Tables may not exist yet (before the migration). Report "not ready".
  const [exists] = await rows(sql`SELECT to_regclass('public.registry_items') IS NOT NULL AS ok`);
  if (!exists?.ok) {
    return {
      ready: false,
      totals: { total: 0, live: 0, sold: 0, other: 0 },
      forSaleOnEbay: 0,
      withNifty: 0,
      coverage: [],
      venueStatus: [],
      review: [],
      reviewSamples: {},
      lastUpdated: null,
    };
  }

  const [t] = await rows(sql`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE status = 'live') AS live,
           count(*) FILTER (WHERE status = 'sold') AS sold,
           max(updated_at) AS last_updated
    FROM registry_items`);

  // "For sale on eBay" = live registry item with a live eBay listing
  // (eBay mirror quantity > 0). Coverage = how many of those have a known
  // listing on each other venue.
  const [ebay] = await rows(sql`
    SELECT count(*) AS for_sale,
           count(*) FILTER (WHERE r.nifty_item_ref IS NOT NULL) AS with_nifty
    FROM registry_items r
    WHERE r.status = 'live'
      AND EXISTS (SELECT 1 FROM venue_listings v
                  WHERE v.registry_item_id = r.id AND v.venue = 'ebay' AND v.status = 'live')`);

  const coverage = await rows(sql`
    WITH live AS (
      SELECT r.id FROM registry_items r
      WHERE r.status = 'live'
        AND EXISTS (SELECT 1 FROM venue_listings v
                    WHERE v.registry_item_id = r.id AND v.venue = 'ebay' AND v.status = 'live'))
    SELECT v.venue,
           count(DISTINCT v.registry_item_id) AS linked,
           count(DISTINCT v.registry_item_id) FILTER (WHERE v.status = 'live') AS live
    FROM venue_listings v JOIN live ON live.id = v.registry_item_id
    WHERE v.venue NOT IN ('ebay', 'etsy')
    GROUP BY v.venue ORDER BY linked DESC`);

  const vs = await rows(sql`SELECT venue, state, note, checked_at FROM venue_status ORDER BY venue`);

  const review = await rows(sql`
    SELECT kind,
           count(*) FILTER (WHERE status = 'open') AS open,
           count(*) FILTER (WHERE status = 'dismissed') AS dismissed
    FROM registry_review GROUP BY kind ORDER BY kind`);

  const samples = await rows(sql`
    SELECT id, kind, registry_item_id, detail FROM (
      SELECT q.*, row_number() OVER (PARTITION BY kind ORDER BY created_at, id) AS rn
      FROM registry_review q WHERE q.status = 'open') s
    WHERE rn <= ${sampleSize}
    ORDER BY kind, rn`);

  const reviewSamples: RegistryReport["reviewSamples"] = {};
  for (const s of samples) {
    const kind = String(s.kind);
    (reviewSamples[kind] ??= []).push({
      id: String(s.id),
      registryItemId: s.registry_item_id ? String(s.registry_item_id) : null,
      detail: (s.detail as Record<string, unknown>) ?? {},
    });
  }

  const total = n(t?.total);
  const live = n(t?.live);
  const sold = n(t?.sold);
  return {
    ready: true,
    totals: { total, live, sold, other: total - live - sold },
    forSaleOnEbay: n(ebay?.for_sale),
    withNifty: n(ebay?.with_nifty),
    coverage: coverage.map((c) => ({ venue: String(c.venue), linked: n(c.linked), live: n(c.live) })),
    venueStatus: vs.map((v) => ({
      venue: String(v.venue),
      state: String(v.state),
      note: v.note ? String(v.note) : null,
      checkedAt: new Date(String(v.checked_at)).toISOString(),
    })),
    review: review.map((r) => ({ kind: String(r.kind), open: n(r.open), dismissed: n(r.dismissed) })),
    reviewSamples,
    lastUpdated: t?.last_updated ? new Date(String(t.last_updated)).toISOString() : null,
  };
}
