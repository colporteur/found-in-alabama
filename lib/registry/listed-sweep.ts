// Full inventory check (readiness test 1, "listings known"): the extension
// reads every item in Nifty's Listed view and posts it through
// /api/admin/items/capture, which marks each Mercari / Poshmark / Depop /
// Whatnot listing live (or sold / ended) with last_seen_at = now. When the
// run finishes, finishListedSweep() records it and — only for a run that
// covered (nearly) everything — marks the listings Nifty no longer shows as
// ended. Listings with a planned delist leg are left to the outcome checker.
// FIA's own tables only; nothing in Nifty or any venue changes.

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export const SWEEP_VENUES = ["mercari", "poshmark", "depop", "whatnot"] as const;
const KEY = "nifty_listed_sweeps";
/** Share of Nifty's Listed total a run must have seen before absences count. */
export const MIN_COVERAGE = 0.98;

export type ListedSweep = {
  startedAt: string;
  finishedAt: string;
  seen: number;
  total: number | null;
  complete: boolean;
  endedUnseen: number;
  venues: Record<string, { live: number; unknown: number }>;
};

/** Pure: may this run mark unseen listings as ended? */
export function sweepCovers(seen: number, total: number | null, complete: boolean): boolean {
  if (!complete || !total || total <= 0) return false;
  return seen / total >= MIN_COVERAGE;
}

async function venueCounts(): Promise<ListedSweep["venues"]> {
  const r = await rows(sql`
    SELECT v.venue, count(*) FILTER (WHERE v.status = 'live')::int AS live,
           count(*) FILTER (WHERE v.status = 'unknown')::int AS unknown
    FROM venue_listings v JOIN registry_items r ON r.id = v.registry_item_id AND r.status = 'live'
    WHERE v.venue IN (${sql.join(SWEEP_VENUES.map((v) => sql`${v}`), sql`, `)}) AND v.status IN ('live', 'unknown')
    GROUP BY v.venue`);
  const out: ListedSweep["venues"] = {};
  for (const v of SWEEP_VENUES) {
    const x = r.find((y) => y.venue === v);
    out[v] = { live: Number(x?.live ?? 0), unknown: Number(x?.unknown ?? 0) };
  }
  return out;
}

export async function lastListedSweeps(): Promise<ListedSweep[]> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = ${KEY}`);
  const v = r?.value as { sweeps?: ListedSweep[] } | undefined;
  return Array.isArray(v?.sweeps) ? v!.sweeps : [];
}

export async function finishListedSweep(p: { startedAt: string; seen: number; total: number | null; complete: boolean }): Promise<ListedSweep> {
  const started = new Date(p.startedAt);
  if (Number.isNaN(started.getTime())) throw new Error("startedAt must be a date");
  let endedUnseen = 0;
  if (sweepCovers(p.seen, p.total, p.complete)) {
    const res = (await db.execute(sql`
      UPDATE venue_listings v SET status = 'ended', updated_at = now()
      WHERE v.venue IN (${sql.join(SWEEP_VENUES.map((x) => sql`${x}`), sql`, `)})
        AND v.status IN ('unknown', 'live')
        AND v.last_seen_at < ${started.toISOString()}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM delist_plans d WHERE d.venue = v.venue AND d.venue_listing_id = v.venue_listing_id)`)) as {
      rowCount?: number | null;
    };
    endedUnseen = res.rowCount ?? 0;
  }
  const sweep: ListedSweep = {
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    seen: p.seen,
    total: p.total,
    complete: p.complete,
    endedUnseen,
    venues: await venueCounts(),
  };
  const sweeps = [sweep, ...(await lastListedSweeps())].slice(0, 20);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify({ sweeps })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  return sweep;
}
