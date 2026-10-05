import { and, gt, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, ebayStoreCategories } from "@/db/schema";
import { tesQualifyingSet } from "@/lib/tes/selection";
import { decodeEntities } from "@/lib/ebay/entities";
import { readActiveStoreListingPage } from "./client";
import { hipReadinessConnection } from "./readiness-connection";
import { buildReadinessReport, type HipSnapshot, type HipInventoryReview } from "./readiness";
import { collectHipReadinessSnapshot } from "./readiness-snapshot";

export async function loadHipReadiness(compareHip = false) {
  const cats = await db.select({
    categoryId: ebayStoreCategories.categoryId,
    parentCategoryId: ebayStoreCategories.parentCategoryId,
    isEphemeralState: ebayStoreCategories.isEphemeralState,
    name: ebayStoreCategories.name,
  }).from(ebayStoreCategories);
  const qualifying = [...tesQualifyingSet(cats)];
  const rows = qualifying.length ? await db.select({
    itemId: ebayListings.itemId, title: ebayListings.title, sku: ebayListings.sku,
    price: ebayListings.price, quantity: ebayListings.quantity, description: ebayListings.description,
    primaryImageUrl: ebayListings.primaryImageUrl, imageUrls: ebayListings.imageUrls,
    siteCategoryId: ebayListings.siteCategoryId, siteCategoryName: ebayListings.siteCategoryName,
    listingType: ebayListings.listingType, lastSyncedAt: ebayListings.lastSyncedAt,
    storeCategory1Id: ebayListings.storeCategory1Id, storeCategory2Id: ebayListings.storeCategory2Id,
  }).from(ebayListings).where(and(gt(ebayListings.quantity, 0), or(
    inArray(ebayListings.storeCategory1Id, qualifying), inArray(ebayListings.storeCategory2Id, qualifying),
  ))).orderBy(ebayListings.itemId) : [];
  const connection = hipReadinessConnection();
  const configured = connection !== null;
  let snapshot: HipSnapshot = {
    state: configured ? "not_checked" : "not_connected", listings: [], pages: 0, checkedAt: null,
    message: configured ? "Run Compare with Hip to check which items are already listed." : "Connect the HipPostcard account to compare existing listings. Your website inventory can be reviewed now.",
  };
  if (connection && compareHip) snapshot = await collectHipReadinessSnapshot((page) => readActiveStoreListingPage(page, connection));
  const names = new Map(cats.map((c) => [c.categoryId, decodeEntities(c.name)]));
  const report = buildReadinessReport(rows.map((row) => ({ ...row,
    storeCategories: [...new Set([row.storeCategory1Id, row.storeCategory2Id].filter((id): id is string => !!id).map((id) => names.get(id) ?? id))],
  })), snapshot, configured);
  // Active Hip stock outside the positive-quantity selection needs a separate
  // check: it may be new to the mirror, outside TES, or no longer available.
  const outsideIds = report.hipUnmatched.map((l) => l.externalId).filter((id): id is string => !!id);
  const outside = outsideIds.length ? await db.select({
    itemId: ebayListings.itemId, quantity: ebayListings.quantity, lastSyncedAt: ebayListings.lastSyncedAt,
  }).from(ebayListings).where(inArray(ebayListings.itemId, outsideIds)) : [];
  const outsideById = new Map(outside.map((l) => [l.itemId, l]));
  report.hipUnmatched = report.hipUnmatched.map((l): HipInventoryReview => {
    const item = l.externalId ? outsideById.get(l.externalId) : undefined;
    return { ...l,
      inventoryStatus: !l.externalId ? "no_item_link" : !item ? "not_in_mirror" : item.quantity == null ? "unknown_quantity" : item.quantity <= 0 ? "zero_quantity" : "outside_selection",
      inventoryQuantity: item?.quantity,
      inventoryLastSyncedAt: item?.lastSyncedAt.toISOString(),
    };
  });
  report.hipUnmatched.sort((a, b) => Number(b.inventoryStatus === "zero_quantity") - Number(a.inventoryStatus === "zero_quantity"));
  return report;
}
