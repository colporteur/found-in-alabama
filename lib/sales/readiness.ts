// Delist readiness (Phase 2 → Phase 7): per venue, has FIA's shadow
// delisting been right every day for 30 days? Scores sale detection
// (anything Nifty recorded that FIA never saw), matching, and every planned
// delist leg on that venue against what actually happened. Read-only apart
// from recording when the extension last ran a Nifty sales check.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { checkOutcomes } from "./pipeline";
import { dayRange, scoreVenue, type DayInput, type VenueScore } from "./readiness-core";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export const READINESS_VENUES = ["mercari", "poshmark", "depop", "whatnot", "ebay", "hip"] as const;
export type ReadinessVenue = (typeof READINESS_VENUES)[number];

/** Where each venue's 30-day clock starts: delist planning began Oct 8;
 *  eBay counts from after the Oct 9 false-sale fixes (PR #15, #17). */
export const CLOCK_START: Record<ReadinessVenue, string> = {
  mercari: "2026-10-08",
  poshmark: "2026-10-08",
  depop: "2026-10-08",
  whatnot: "2026-10-08",
  ebay: "2026-10-10",
  hip: "2026-10-08",
};

/** How FIA confirms a delist there, for the page. */
export const VERIFY_HOW: Record<ReadinessVenue, string> = {
  mercari: "Nifty sales check (extension)",
  poshmark: "Nifty sales check (extension)",
  depop: "Nifty sales check (extension)",
  whatnot: "Nifty sales check (extension)",
  ebay: "eBay mirror, every 15 min",
  hip: "HipPostcard listings, automatic",
};

const local = (col: ReturnType<typeof sql>) => sql`to_char((${col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago'), 'YYYY-MM-DD')`;

/** Midnight at the start of a US Central calendar day, in ms (CDT or CST). */
export function centralMidnight(day: string): number {
  for (const off of ["-05:00", "-06:00"]) {
    const t = Date.parse(`${day}T00:00:00${off}`);
    const d = new Date(t);
    const local = d.toLocaleString("en-CA", { timeZone: "America/Chicago", hour12: false });
    if (local.startsWith(`${day}, 00:`) || local.startsWith(`${day}, 24:`)) return t;
  }
  return Date.parse(`${day}T00:00:00-06:00`);
}

function todayCentral(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

// ─── Nifty sales checks (the extension's "Check sales & delists") ────────────

export type NiftyCheck = { at: string; since: string; items: number; complete: boolean };

export async function niftyChecks(): Promise<NiftyCheck[]> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = 'nifty_sold_checks'`);
  const list = (r?.value as { checks?: NiftyCheck[] } | undefined)?.checks;
  return Array.isArray(list) ? list : [];
}

/** The window the extension should read: back to the oldest delist still
 *  waiting for confirmation (or the last check), a day of overlap, ≤ 45 days. */
export async function niftyCheckWindow(): Promise<{ since: string; lastCheck: string | null; openLegs: number }> {
  const checks = await niftyChecks();
  const last = checks.find((c) => c.complete) ?? null;
  const [o] = await rows(sql`
    SELECT count(*)::int AS open, extract(epoch FROM min(COALESCE(e.sold_at, e.detected_at, p.planned_at))) * 1000 AS oldest_ms
    FROM delist_plans p LEFT JOIN sale_events e ON e.id = p.sale_event_id
    WHERE p.venue NOT IN ('ebay', 'hip') AND p.outcome IN ('pending', 'unverified', 'still_live')
      AND p.planned_at > now() - interval '30 days'`);
  const floor = Date.now() - 45 * 86400_000;
  const candidates = [
    o?.oldest_ms != null ? Number(o.oldest_ms) - 86400_000 : null,
    last ? Date.parse(last.at) - 2 * 86400_000 : null,
  ].filter((x): x is number => x != null && Number.isFinite(x));
  const clockStart = centralMidnight(Object.values(CLOCK_START).sort()[0]) - 86400_000;
  const since = Math.max(floor, Math.min(clockStart, ...(candidates.length ? candidates : [Date.now() - 30 * 86400_000])));
  return { since: new Date(since).toISOString(), lastCheck: checks[0]?.at ?? null, openLegs: n(o?.open) };
}

/** The extension finished a check: remember it, and score outcomes now. */
export async function recordNiftyCheck(c: { since: string; items: number; complete: boolean }) {
  const prev = await niftyChecks();
  const entry: NiftyCheck = {
    at: new Date().toISOString(),
    since: new Date(Date.parse(c.since) || Date.now()).toISOString(),
    items: Math.max(0, Math.round(Number(c.items) || 0)),
    complete: c.complete === true,
  };
  const checks = [entry, ...prev].slice(0, 30);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('nifty_sold_checks', ${JSON.stringify({ checks })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  const outcomes = await checkOutcomes();
  return { check: entry, outcomes };
}

/** A day is covered when a complete check started before it and ran after it ended. */
export function dayCovered(day: string, checks: NiftyCheck[]): boolean {
  const startMs = centralMidnight(day);
  const endMs = startMs + 25 * 3600_000; // a day, with room for a DST change
  return checks.some((c) => c.complete && Date.parse(c.since) <= startMs && Date.parse(c.at) >= endMs);
}

// ─── the report ──────────────────────────────────────────────────────────────

export type ReadinessIssue = { day: string; kind: string; title: string | null; detail: string | null };

export type VenueReadiness = VenueScore & {
  venue: ReadinessVenue;
  start: string;
  verifiedBy: string;
  totals: { sales: number; legs: number; legsDone: number; legsNiftyFailed: number; legsOpen: number };
  issues: ReadinessIssue[];
  listings: { live: number; unknown: number; lastSeen: string | null };
};

export type Readiness = {
  today: string;
  lastCheck: NiftyCheck | null;
  venues: VenueReadiness[];
};

export async function readinessReport(): Promise<Readiness> {
  const today = todayCentral();
  const start = Object.values(CLOCK_START).sort()[0];
  const from = sql`((${start}::date)::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`;
  const checks = await niftyChecks();

  const sales = await rows(sql`
    SELECT e.venue, ${local(sql`COALESCE(e.sold_at, e.detected_at)`)} AS day, count(*)::int AS sales,
           count(*) FILTER (WHERE e.status IN ('unmatched', 'ambiguous'))::int AS unmatched
    FROM sale_events e
    WHERE e.status NOT IN ('duplicate', 'ignored') AND COALESCE(e.sold_at, e.detected_at) >= ${from}
    GROUP BY 1, 2`);

  // Sales Nifty recorded that FIA has no sale for (any status but ignored).
  const missedRows = await rows(sql`
    SELECT i.sold_on_marketplace AS venue, ${local(sql`i.sold_at`)} AS day, i.title
    FROM items i
    WHERE i.status = 'sold' AND i.sold_at >= ${from} AND i.sold_on_marketplace IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM registry_items r JOIN sale_events e ON e.registry_item_id = r.id AND e.status <> 'ignored'
                      WHERE r.nifty_item_ref = i.id)
    ORDER BY i.sold_at DESC LIMIT 500`);

  const legs = await rows(sql`
    SELECT p.venue, ${local(sql`p.planned_at`)} AS day, count(*)::int AS legs,
           count(*) FILTER (WHERE p.outcome = 'done')::int AS done,
           count(*) FILTER (WHERE p.outcome = 'failed_nifty')::int AS nifty_failed,
           count(*) FILTER (WHERE p.outcome = 'still_live' AND p.planned_at < now() - interval '24 hours')::int AS still_old,
           count(*) FILTER (WHERE p.outcome IN ('pending', 'unverified')
                              OR (p.outcome = 'still_live' AND p.planned_at >= now() - interval '24 hours'))::int AS open
    FROM delist_plans p WHERE p.planned_at >= ${from} AND p.outcome <> 'void'
    GROUP BY 1, 2`);

  const legIssues = await rows(sql`
    SELECT p.venue, ${local(sql`p.planned_at`)} AS day, r.title, p.venue_listing_id
    FROM delist_plans p LEFT JOIN registry_items r ON r.id = p.registry_item_id
    WHERE p.planned_at >= ${from} AND p.outcome = 'still_live' AND p.planned_at < now() - interval '24 hours'
    ORDER BY p.planned_at DESC LIMIT 200`);

  const unmatchedRows = await rows(sql`
    SELECT e.venue, ${local(sql`COALESCE(e.sold_at, e.detected_at)`)} AS day, e.title
    FROM sale_events e WHERE e.status IN ('unmatched', 'ambiguous') AND COALESCE(e.sold_at, e.detected_at) >= ${from}
    ORDER BY COALESCE(e.sold_at, e.detected_at) DESC LIMIT 200`);

  const listings = await rows(sql`
    SELECT v.venue, count(*) FILTER (WHERE v.status = 'live')::int AS live,
           count(*) FILTER (WHERE v.status = 'unknown')::int AS unknown, max(v.last_seen_at) AS last_seen
    FROM venue_listings v JOIN registry_items r ON r.id = v.registry_item_id AND r.status = 'live'
    WHERE v.status IN ('live', 'unknown') GROUP BY v.venue`);

  const key = (v: unknown, d: unknown) => `${v}|${d}`;
  const saleMap = new Map(sales.map((r) => [key(r.venue, r.day), r]));
  const legMap = new Map(legs.map((r) => [key(r.venue, r.day), r]));
  const missedCount = new Map<string, number>();
  for (const m of missedRows) missedCount.set(key(m.venue, m.day), (missedCount.get(key(m.venue, m.day)) ?? 0) + 1);

  const venues: VenueReadiness[] = READINESS_VENUES.map((venue) => {
    const vStart = CLOCK_START[venue];
    const days: DayInput[] = dayRange(vStart, today).map((day) => {
      const s = saleMap.get(key(venue, day));
      const l = legMap.get(key(venue, day));
      return {
        day,
        sales: n(s?.sales),
        unmatched: n(s?.unmatched),
        missed: missedCount.get(key(venue, day)) ?? 0,
        legs: n(l?.legs),
        legsDone: n(l?.done),
        legsNiftyFailed: n(l?.nifty_failed),
        legsStillLiveOld: n(l?.still_old),
        legsOpen: n(l?.open),
        missedCheckCovered: dayCovered(day, checks),
      };
    });
    const score = scoreVenue(days, today);
    const sum = (k: keyof DayInput) => days.reduce((t, d) => t + Number(d[k]), 0);
    const inWindow = (d: unknown) => String(d) >= vStart;
    const issues: ReadinessIssue[] = [
      ...missedRows.filter((m) => m.venue === venue && inWindow(m.day)).map((m) => ({ day: String(m.day), kind: "missed sale", title: (m.title as string) ?? null, detail: "Nifty recorded this sale; FIA has no sale for it" })),
      ...unmatchedRows.filter((m) => m.venue === venue && inWindow(m.day)).map((m) => ({ day: String(m.day), kind: "unmatched sale", title: (m.title as string) ?? null, detail: "Resolve it in the review queue on /admin/sales" })),
      ...legIssues.filter((m) => m.venue === venue && inWindow(m.day)).map((m) => ({ day: String(m.day), kind: "still listed", title: (m.title as string) ?? null, detail: `Planned delist still up a day later (listing ${m.venue_listing_id ?? "?"})` })),
    ].sort((a, b) => b.day.localeCompare(a.day));
    const li = listings.find((x) => x.venue === venue);
    return {
      venue,
      start: vStart,
      verifiedBy: VERIFY_HOW[venue],
      ...score,
      totals: { sales: sum("sales"), legs: sum("legs"), legsDone: sum("legsDone"), legsNiftyFailed: sum("legsNiftyFailed"), legsOpen: sum("legsOpen") },
      issues,
      listings: { live: n(li?.live), unknown: n(li?.unknown), lastSeen: iso(li?.last_seen) },
    };
  });

  return { today, lastCheck: checks[0] ?? null, venues };
}
