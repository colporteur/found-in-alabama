// Which items are on sale RIGHT NOW? Read-side helper for the public
// haul pages (and anywhere else that wants an on-sale badge).
//
// "On sale" = an ebay_sales row in SCHEDULED/RUNNING whose window covers
// this moment, matched to an item either by eBay listing id (tier sales
// store scope.listingIds) or by store category (wizard sales store
// scope.categoryIds, matched against the item's cached
// ebayStoreCategoryId). Only sales created by this tool are known —
// sales made directly in Seller Hub won't show a badge.

import { and, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { ebaySales } from "@/db/schema";

export type SaleBadge = {
  discountPercent: number;
  endsAt: Date;
};

export type OnSaleLookup = {
  byListingId: Map<string, SaleBadge>;
  byCategoryId: Map<string, SaleBadge>;
};

/** Numeric eBay listing id out of a marketplace URL. */
export function ebayListingIdFromUrl(
  url: string | null | undefined
): string | null {
  if (!url) return null;
  const m =
    url.match(/\/itm\/(?:[^/]*\/)?(\d{9,14})/) ?? url.match(/\b(\d{11,14})\b/);
  return m ? m[1] : null;
}

/** Keep the better (deeper) discount when two sales cover the same key. */
function put(map: Map<string, SaleBadge>, key: string, badge: SaleBadge) {
  const prev = map.get(key);
  if (!prev || badge.discountPercent > prev.discountPercent) {
    map.set(key, badge);
  }
}

export async function getOnSaleLookup(
  now: Date = new Date()
): Promise<OnSaleLookup> {
  const byListingId = new Map<string, SaleBadge>();
  const byCategoryId = new Map<string, SaleBadge>();

  try {
    const live = await db
      .select({
        scope: ebaySales.scope,
        discountPercent: ebaySales.discountPercent,
        endsAt: ebaySales.endsAt,
      })
      .from(ebaySales)
      .where(
        and(
          inArray(ebaySales.status, ["SCHEDULED", "RUNNING"]),
          lte(ebaySales.startsAt, now),
          gte(ebaySales.endsAt, now)
        )
      );

    for (const sale of live) {
      const pct = Number(sale.discountPercent);
      if (!Number.isFinite(pct) || pct <= 0) continue;
      const badge: SaleBadge = { discountPercent: pct, endsAt: sale.endsAt };
      const scope = sale.scope as {
        listingIds?: string[];
        categoryIds?: string[];
      };
      for (const id of scope.listingIds ?? []) put(byListingId, id, badge);
      for (const id of scope.categoryIds ?? []) put(byCategoryId, id, badge);
    }
  } catch {
    // Public page resilience: a DB hiccup should never break the haul
    // page render — just show no badges.
  }

  return { byListingId, byCategoryId };
}
