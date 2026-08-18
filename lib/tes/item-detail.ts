// TES product-page data. Loads one listing from the mirror, verifies it
// belongs to the TES segment and is in stock, applies sale pricing and
// ship class, and — when the mirror doesn't have the description yet
// (rows older than the description-capturing sweep) — fetches it live
// from eBay ONCE and caches it back into the mirror.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, ebayStoreCategories } from "@/db/schema";
import { getOnSaleLookup } from "@/lib/ebay/active-sales";
import { tradingCall } from "@/lib/ebay/client";
import { decodeEntities } from "@/lib/ebay/entities";
import {
  maxShipClass,
  normalizeShipClass,
  type ShipClass,
} from "@/lib/tes/shipping";

export type TesItemDetail = {
  itemId: string;
  title: string;
  sku: string | null;
  price: number;
  salePrice: number | null;
  discountPercent: number | null;
  saleEndsAt: Date | null;
  images: string[];
  descriptionHtml: string | null;
  shipClass: ShipClass;
  quantity: number;
  ebayUrl: string;
};

type CatRow = {
  categoryId: string;
  parentCategoryId: string | null;
  isEphemeralState: boolean;
  shipClass: string;
};

/** Category ids that belong to the TES segment (flagged or descendant). */
export function tesQualifyingSet(cats: CatRow[]): Set<string> {
  const parentOf = new Map(cats.map((c) => [c.categoryId, c.parentCategoryId]));
  const flagged = new Set(
    cats.filter((c) => c.isEphemeralState).map((c) => c.categoryId)
  );
  const out = new Set<string>();
  for (const c of cats) {
    let cur: string | null = c.categoryId;
    let hops = 0;
    while (cur != null && hops < 20) {
      if (flagged.has(cur)) {
        out.add(c.categoryId);
        break;
      }
      cur = parentOf.get(cur) ?? null;
      hops++;
    }
  }
  return out;
}

export async function loadTesCategories(): Promise<CatRow[]> {
  return db
    .select({
      categoryId: ebayStoreCategories.categoryId,
      parentCategoryId: ebayStoreCategories.parentCategoryId,
      isEphemeralState: ebayStoreCategories.isEphemeralState,
      shipClass: ebayStoreCategories.shipClass,
    })
    .from(ebayStoreCategories);
}

async function fetchAndCacheDescription(
  itemId: string
): Promise<{ description: string | null; imageUrls: string[] }> {
  try {
    const res = await tradingCall<{
      Item?: {
        Description?: unknown;
        PictureDetails?: { PictureURL?: unknown };
      };
    }>("GetItem", {
      ItemID: itemId,
      DetailLevel: "ReturnAll",
      OutputSelector: "Item.Description,Item.PictureDetails.PictureURL",
    });
    const d = res.Item?.Description;
    const description =
      d != null && String(d).trim() !== "" ? String(d) : null;
    const pu = res.Item?.PictureDetails?.PictureURL;
    const imageUrls = (Array.isArray(pu) ? pu : pu != null ? [pu] : [])
      .map((u) => String(u))
      .filter((u) => u.startsWith("http"));
    if (description || imageUrls.length > 0) {
      await db
        .update(ebayListings)
        .set({
          ...(description ? { description } : {}),
          ...(imageUrls.length > 0 ? { imageUrls } : {}),
        })
        .where(eq(ebayListings.itemId, itemId));
    }
    return { description, imageUrls };
  } catch (err) {
    console.warn(`[tes item] live description fetch failed ${itemId}:`, err);
    return { description: null, imageUrls: [] };
  }
}

export async function getTesItemDetail(
  itemId: string
): Promise<TesItemDetail | null> {
  if (!/^\d{6,20}$/.test(itemId)) return null;

  const [[row], cats, onSale] = await Promise.all([
    db.select().from(ebayListings).where(eq(ebayListings.itemId, itemId)).limit(1),
    loadTesCategories(),
    getOnSaleLookup(),
  ]);
  if (!row || (row.quantity ?? 0) <= 0) return null;

  // Segment gate: FIA-only items 404 on the TES domain.
  const qualifies = tesQualifyingSet(cats);
  const inTes =
    (row.storeCategory1Id != null && qualifies.has(row.storeCategory1Id)) ||
    (row.storeCategory2Id != null && qualifies.has(row.storeCategory2Id));
  if (!inTes) return null;

  const price = row.price != null ? parseFloat(row.price) : NaN;
  if (!Number.isFinite(price)) return null;

  const classByCat = new Map(cats.map((c) => [c.categoryId, c.shipClass]));
  const c1 = normalizeShipClass(
    row.storeCategory1Id ? classByCat.get(row.storeCategory1Id) : undefined
  );
  const c2 = normalizeShipClass(
    row.storeCategory2Id ? classByCat.get(row.storeCategory2Id) : undefined
  );

  const badge =
    onSale.byListingId.get(row.itemId) ??
    (row.storeCategory1Id
      ? onSale.byCategoryId.get(row.storeCategory1Id)
      : undefined) ??
    (row.storeCategory2Id
      ? onSale.byCategoryId.get(row.storeCategory2Id)
      : undefined) ??
    null;

  let description = row.description;
  let images = Array.isArray(row.imageUrls)
    ? (row.imageUrls as string[])
    : row.primaryImageUrl
      ? [row.primaryImageUrl]
      : [];

  if (!description) {
    const live = await fetchAndCacheDescription(row.itemId);
    description = live.description;
    if (live.imageUrls.length > 0) images = live.imageUrls;
  }

  // The Trading client stores XML-escaped strings (&lt;p&gt; instead of
  // <p>) because entity processing is disabled parser-side. Decode here so
  // the page gets real HTML — it sanitizes before rendering.
  if (description) description = decodeEntities(description);

  return {
    itemId: row.itemId,
    title: decodeEntities(row.title),
    sku: row.sku,
    price,
    salePrice: badge
      ? Math.round(price * (1 - badge.discountPercent / 100) * 100) / 100
      : null,
    discountPercent: badge ? badge.discountPercent : null,
    saleEndsAt: badge ? badge.endsAt : null,
    images,
    descriptionHtml: description,
    shipClass: maxShipClass(c1, c2),
    quantity: row.quantity ?? 0,
    ebayUrl: `https://www.ebay.com/itm/${row.itemId}`,
  };
}
