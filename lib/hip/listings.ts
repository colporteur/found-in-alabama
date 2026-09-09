// Hip listing map refresh (Phase HIP-1, used by HIP-2's reconciliation).
// Walks every active listing in the store and upserts hip_listings so the
// Hip id ↔ eBay item id map is current. ~1,100 listings at 100/page = a
// dozen calls; safe to run daily alongside the full eBay sweep.

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, hipListings } from "@/db/schema";
import { findActiveStoreListings, hipConfigured } from "@/lib/hip/client";
import { closeHipForItems, type HipCloseSummary } from "@/lib/hip/close";
import { upsertHipListing } from "@/lib/hip/ingest";

export type HipMapRefreshResult = {
  configured: boolean;
  pages: number;
  seen: number;
  withExternalId: number;
  /** Rows not seen in this walk, now flagged inactive. */
  retired: number;
};

export async function refreshHipListingMap(maxPages = 60): Promise<HipMapRefreshResult> {
  const result: HipMapRefreshResult = {
    configured: hipConfigured(),
    pages: 0,
    seen: 0,
    withExternalId: 0,
    retired: 0,
  };
  if (!result.configured) return result;

  const startedAt = new Date();
  const limit = 100;
  for (let page = 1; page <= maxPages; page++) {
    const { results } = await findActiveStoreListings({ page, limit });
    result.pages++;
    for (const l of results) {
      await upsertHipListing(l);
      result.seen++;
      if (l.external_id) result.withExternalId++;
    }
    if (results.length < limit) break;
  }

  // Anything active in our map that this full walk did not touch is no
  // longer active on Hip (sold, closed by Hip's sync, or by us).
  if (result.seen > 0) {
    const retired = await db
      .update(hipListings)
      .set({ active: false })
      .where(sql`${hipListings.active} = true AND ${hipListings.lastSeenAt} < ${startedAt}`)
      .returning({ hipId: hipListings.hipId });
    result.retired = retired.length;
  }
  return result;
}

// ─── Daily reconciliation (Phase HIP-2) ──────────────────────────────────────
//
// After the map refresh: any Hip listing still active whose eBay item is
// sold out in the mirror gets closed on Hip — this is the catch-all for
// anything Hip's own sync (or our 15-minute tick) missed. Hip listings
// whose eBay item isn't in the mirror at all are reported as drift, not
// closed: that can be a brand-new eBay listing Hip imported before our
// daily sweep did, and closing it would be wrong.

export type HipReconcileResult = {
  configured: boolean;
  activeOnHip: number;
  soldOutOnEbay: number;
  close: HipCloseSummary | null;
  /** Active Hip listings with an eBay id the mirror doesn't know. */
  driftUnknownOnEbay: number;
  /** Active Hip listings with no eBay id at all (not from the sync). */
  driftNoExternalId: number;
};

export async function reconcileHipAgainstMirror(): Promise<HipReconcileResult> {
  const result: HipReconcileResult = {
    configured: hipConfigured(),
    activeOnHip: 0,
    soldOutOnEbay: 0,
    close: null,
    driftUnknownOnEbay: 0,
    driftNoExternalId: 0,
  };
  if (!result.configured) return result;

  const active = await db
    .select({ hipId: hipListings.hipId, externalId: hipListings.externalId })
    .from(hipListings)
    .where(eq(hipListings.active, true));
  result.activeOnHip = active.length;
  result.driftNoExternalId = active.filter((r) => !r.externalId).length;

  const ids = active.map((r) => r.externalId).filter((x): x is string => !!x);
  if (ids.length === 0) return result;

  const mirror = await db
    .select({ itemId: ebayListings.itemId, quantity: ebayListings.quantity })
    .from(ebayListings)
    .where(inArray(ebayListings.itemId, ids));
  const qtyById = new Map(mirror.map((m) => [m.itemId, m.quantity ?? 0]));

  const soldOut: string[] = [];
  for (const id of ids) {
    if (!qtyById.has(id)) {
      result.driftUnknownOnEbay++;
    } else if ((qtyById.get(id) ?? 0) <= 0) {
      soldOut.push(id);
    }
  }
  result.soldOutOnEbay = soldOut.length;
  if (soldOut.length > 0) {
    result.close = await closeHipForItems(soldOut, "sweep");
  }
  return result;
}
