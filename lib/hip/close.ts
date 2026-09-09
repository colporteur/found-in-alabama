// Phase HIP-2: the everywhere-else → Hip direction.
//
// When an eBay item zeroes in the mirror (sold on eBay, ended by Nifty
// after a Poshmark/Mercari/... sale, sold on theephemeralstate.com, or
// ended by the Hip poller itself), close the matching Hip listing by API
// instead of trusting Hip's "Sync with eBay" to notice. A 404 from Hip
// means it already noticed — that's fine, the goal state is reached.
//
// Every call is best-effort and swallowed: a Hip hiccup must never break
// the events sync or the Stripe webhook that called it. Outcomes go to
// hip_actions (kind "close_hip") so the board can show drift.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { hipActions, hipListings } from "@/db/schema";
import { closeListing, hipConfigured } from "@/lib/hip/client";

export type HipCloseSummary = {
  configured: boolean;
  matched: number;
  closed: number;
  alreadyGone: number;
  failed: number;
};

/**
 * Close the Hip listings mapped to these eBay item ids. `origin` is
 * recorded in the action log ("events-sync", "tes-webhook",
 * "hip-ingest", "sweep").
 */
export async function closeHipForItems(
  itemIds: string[],
  origin: string
): Promise<HipCloseSummary> {
  const summary: HipCloseSummary = {
    configured: hipConfigured(),
    matched: 0,
    closed: 0,
    alreadyGone: 0,
    failed: 0,
  };
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!summary.configured || ids.length === 0) return summary;

  try {
    const rows = await db
      .select({ hipId: hipListings.hipId, externalId: hipListings.externalId })
      .from(hipListings)
      .where(and(inArray(hipListings.externalId, ids), eq(hipListings.active, true)));
    summary.matched = rows.length;

    for (const row of rows) {
      const r = await closeListing(row.hipId);
      if (r.ok) {
        if (r.alreadyGone) summary.alreadyGone++;
        else summary.closed++;
        await db
          .update(hipListings)
          .set({ active: false, closed: true, lastSeenAt: new Date() })
          .where(eq(hipListings.hipId, row.hipId));
      } else {
        summary.failed++;
      }
      await db.insert(hipActions).values({
        kind: "close_hip",
        hipListingId: row.hipId,
        itemId: row.externalId,
        ok: r.ok,
        detail: `${origin}: ${r.detail}`.slice(0, 1000),
      });
    }
  } catch (err) {
    console.error(`[hip close] ${origin} failed:`, err);
  }
  return summary;
}
