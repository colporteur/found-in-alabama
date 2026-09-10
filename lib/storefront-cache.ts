// Storefront ISR cache control.
//
// The public storefront pages (FIA /shop/* and every TES page under
// /tes/*) are ISR-cached with STOREFRONT_REVALIDATE_SECONDS. That is what
// keeps crawler traffic off the function tier (Sep 2026 Fluid CPU
// overage). Staleness is bounded two ways: the time-based revalidate
// below, and on-demand purges from anything that changes what those
// pages show — the events delta sync (sold/ended/repriced), the daily
// full sweep, the categorizer, and the TES admin settings.
//
// revalidatePath(path, "layout") purges every cached page under that
// path in one call, which is what we want: a sale changes prices on
// item pages, category grids, and the home page alike.

import { revalidatePath } from "next/cache";

/** ISR window for storefront pages. 10 minutes; sold items are purged sooner. */
export const STOREFRONT_REVALIDATE_SECONDS = 600;

/**
 * Purge every cached storefront page (both sites). Cheap — it only
 * marks entries stale; the next visitor to each page re-renders it.
 */
export function revalidateStorefront(reason: string): void {
  try {
    revalidatePath("/tes", "layout");
    revalidatePath("/shop", "layout");
    revalidatePath("/", "page");
    console.log(`[storefront-cache] purged (${reason})`);
  } catch (err) {
    // Never let a cache purge break the caller (e.g. a cron tick).
    console.warn(`[storefront-cache] purge failed (${reason}):`, err);
  }
}

/** Purge just the item pages for specific listings (both sites). */
export function revalidateStorefrontItems(itemIds: string[]): void {
  try {
    for (const id of itemIds) revalidatePath(`/tes/item/${id}`, "page");
  } catch (err) {
    console.warn("[storefront-cache] item purge failed:", err);
  }
}
