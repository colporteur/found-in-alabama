// Phase 7, Mercari worker step 2 — "Delist on Mercari" (pilot).
//
// FIA already plans every Mercari delist in shadow mode (delist_plans, venue
// 'mercari'). The Nifty Sync extension shows the open ones and, when Todd
// presses Delist, deactivates the listing in his own signed-in Mercari tab
// by clicking Mercari's own buttons (My listings → search → tick → Deactivate),
// then checks the Inactive tab. It reports back here; FIA records what it did
// in the leg's evidence and, when Mercari confirmed it, closes the leg as done.
// Nifty keeps auto-delisting as the backup. Nothing here touches Mercari.

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

/** How far back the queue looks (older legs are Nifty's or stale). */
export const QUEUE_DAYS = 14;

export const RESULTS = ["deactivated", "already_inactive", "not_found", "error"] as const;
export type MercariResult = (typeof RESULTS)[number];

/** Pure: the words Mercari's "Search within active" box gets. */
export function searchWords(title: string): string {
  return String(title ?? "")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
}

export type MercariLeg = {
  legId: string;
  mercariId: string;
  title: string;
  search: string;
  soldOn: string | null;
  soldAt: string | null;
  plannedAt: string;
  outcome: string;
  lastTry: { at: string; result: string; detail: string | null } | null;
};

/** Open Mercari delist legs FIA hasn't finished, newest first. */
export async function mercariDelistQueue(limit = 50): Promise<MercariLeg[]> {
  const found = await rows(sql`
    SELECT p.id, p.venue_listing_id, p.planned_at, p.outcome, p.evidence->'fia_mercari' AS last_try,
           COALESCE(r.title, e.title) AS title, e.venue AS sold_on, COALESCE(e.sold_at, e.detected_at) AS sold_at
    FROM delist_plans p
    LEFT JOIN registry_items r ON r.id = p.registry_item_id
    LEFT JOIN sale_events e ON e.id = p.sale_event_id
    WHERE p.venue = 'mercari' AND p.venue_listing_id ~ '^m[0-9]+$'
      AND p.outcome IN ('pending', 'unverified', 'still_live', 'failed_nifty')
      AND p.planned_at > now() - make_interval(days => ${QUEUE_DAYS})
    ORDER BY p.planned_at DESC
    LIMIT ${limit}`);
  const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  return found.map((r) => {
    const t = (r.last_try ?? null) as { at?: string; result?: string; detail?: string | null } | null;
    return {
      legId: String(r.id),
      mercariId: String(r.venue_listing_id),
      title: String(r.title ?? ""),
      search: searchWords(String(r.title ?? "")),
      soldOn: (r.sold_on as string | null) ?? null,
      soldAt: iso(r.sold_at),
      plannedAt: iso(r.planned_at) ?? "",
      outcome: String(r.outcome),
      lastTry: t?.result ? { at: String(t.at ?? ""), result: String(t.result), detail: t.detail ?? null } : null,
    };
  });
}

/** Record what the extension did. Mercari-confirmed results close the leg. */
export async function recordMercariDelist(p: { legId: string; result: string; detail?: string | null; who: string }) {
  if (!(RESULTS as readonly string[]).includes(p.result)) throw new Error(`result must be one of ${RESULTS.join(", ")}`);
  const [leg] = await rows(sql`SELECT id, venue, venue_listing_id, outcome FROM delist_plans WHERE id = ${p.legId}::uuid`);
  if (!leg || leg.venue !== "mercari") throw new Error("Not a Mercari delist leg");
  const tryInfo = JSON.stringify({ at: new Date().toISOString(), result: p.result, detail: (p.detail ?? "").slice(0, 300) || null, by: p.who });
  const confirmed = p.result === "deactivated" || p.result === "already_inactive";
  await db.execute(sql`
    UPDATE delist_plans SET
      evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object('fia_mercari', ${tryInfo}::jsonb)
        || CASE WHEN ${confirmed} THEN jsonb_build_object('source', 'fia_mercari') ELSE '{}'::jsonb END,
      outcome = CASE WHEN ${confirmed} AND outcome <> 'void' THEN 'done' ELSE outcome END,
      outcome_at = CASE WHEN ${confirmed} AND outcome <> 'void' THEN now() ELSE outcome_at END,
      checked_at = now()
    WHERE id = ${p.legId}::uuid`);
  if (confirmed) {
    await db.execute(sql`
      UPDATE venue_listings SET status = 'ended', last_seen_at = now(), updated_at = now()
      WHERE venue = 'mercari' AND venue_listing_id = ${String(leg.venue_listing_id)} AND status IN ('live', 'unknown')`);
  }
  return { ok: true, closed: confirmed };
}
