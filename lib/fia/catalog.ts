// Shared FIA pricing + shipping facts for one mirror row (Phase FIA-SHOP-1).
// Used by the cart resolver (checkout + quote API), the product page, and
// the shop grid, so every surface agrees on price, ship class, weight and
// whether the item can be bought here or is eBay-only.

import { db } from "@/db";
import { ebayListings, ebayStoreCategories } from "@/db/schema";
import { getOnSaleLookup } from "@/lib/ebay/active-sales";
import { decodeEntities } from "@/lib/ebay/entities";
import { bestDiscountPercent, discountedPrice } from "@/lib/tes/discount";
import { getFiaDiscountPercent, getFiaShipSettings } from "@/lib/fia/settings";
import {
  directSaleCheck,
  isMediaService,
  normalizeShipClass,
  type FiaShipItem,
  type FiaShipSettings,
  type ShipClass,
} from "@/lib/fia/shipping";

/** Columns every FIA surface selects from ebay_listings. */
export const fiaListingColumns = {
  itemId: ebayListings.itemId,
  title: ebayListings.title,
  sku: ebayListings.sku,
  price: ebayListings.price,
  quantity: ebayListings.quantity,
  imageUrl: ebayListings.primaryImageUrl,
  cat1: ebayListings.storeCategory1Id,
  cat2: ebayListings.storeCategory2Id,
  pkgWeightOz: ebayListings.pkgWeightOz,
  pkgLengthIn: ebayListings.pkgLengthIn,
  pkgWidthIn: ebayListings.pkgWidthIn,
  pkgDepthIn: ebayListings.pkgDepthIn,
  shippingServices: ebayListings.shippingServices,
};

export type FiaListingRow = {
  itemId: string;
  title: string;
  sku: string | null;
  price: string | null;
  quantity: number | null;
  imageUrl: string | null;
  cat1: string | null;
  cat2: string | null;
  pkgWeightOz: string | null;
  pkgLengthIn: string | null;
  pkgWidthIn: string | null;
  pkgDepthIn: string | null;
  shippingServices: unknown;
};

export type FiaPricingContext = {
  settings: FiaShipSettings;
  flatPct: number;
  classByCat: Map<string, string>;
  onSale: Awaited<ReturnType<typeof getOnSaleLookup>>;
};

export async function loadFiaPricingContext(): Promise<FiaPricingContext> {
  const [settings, flatPct, cats, onSale] = await Promise.all([
    getFiaShipSettings(),
    getFiaDiscountPercent(),
    db
      .select({
        categoryId: ebayStoreCategories.categoryId,
        shipClass: ebayStoreCategories.shipClass,
      })
      .from(ebayStoreCategories),
    getOnSaleLookup(),
  ]);
  return {
    settings,
    flatPct,
    classByCat: new Map(cats.map((c) => [c.categoryId, c.shipClass])),
    onSale,
  };
}

const RANK: Record<ShipClass, number> = { paper: 0, media: 1, bulky: 2 };

function n(v: string | null): number | null {
  if (v == null) return null;
  const x = parseFloat(v);
  return Number.isFinite(x) && x > 0 ? x : null;
}

export type FiaItemFacts = {
  itemId: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  /** eBay price. */
  listPrice: number;
  /** What foundinalabama.com charges (best of FIA discount vs eBay sale). */
  price: number;
  discountPercent: number;
  /** Time-boxed eBay sale end, when that sale is the winning discount. */
  saleEndsAt: Date | null;
  quantity: number;
  ship: FiaShipItem;
  /** False = eBay-only (over the weight/size cap). */
  directSale: boolean;
  directSaleReason: "too_heavy" | "too_big" | null;
};

/** Null when the row has no usable price. */
export function fiaItemFacts(
  r: FiaListingRow,
  ctx: FiaPricingContext
): FiaItemFacts | null {
  const listPrice = r.price != null ? parseFloat(r.price) : NaN;
  if (!Number.isFinite(listPrice)) return null;

  const badge =
    ctx.onSale.byListingId.get(r.itemId) ??
    (r.cat1 ? ctx.onSale.byCategoryId.get(r.cat1) : undefined) ??
    (r.cat2 ? ctx.onSale.byCategoryId.get(r.cat2) : undefined) ??
    null;
  const pct = bestDiscountPercent(ctx.flatPct, badge?.discountPercent);
  const saleWins = badge != null && badge.discountPercent >= ctx.flatPct;

  const c1 = normalizeShipClass(r.cat1 ? ctx.classByCat.get(r.cat1) : undefined);
  const c2 = normalizeShipClass(r.cat2 ? ctx.classByCat.get(r.cat2) : undefined);
  const shipClass = RANK[c1] >= RANK[c2] ? c1 : c2;

  const ship: FiaShipItem = {
    weightOz: n(r.pkgWeightOz),
    lengthIn: n(r.pkgLengthIn),
    widthIn: n(r.pkgWidthIn),
    depthIn: n(r.pkgDepthIn),
    shipClass,
    mediaEligible: isMediaService(r.shippingServices),
  };
  const check = directSaleCheck(ship, ctx.settings);

  return {
    itemId: r.itemId,
    title: decodeEntities(r.title),
    sku: r.sku,
    imageUrl: r.imageUrl,
    listPrice,
    price: discountedPrice(listPrice, pct),
    discountPercent: pct,
    saleEndsAt: saleWins && badge ? badge.endsAt : null,
    quantity: r.quantity ?? 0,
    ship,
    directSale: check.ok,
    directSaleReason: check.ok ? null : check.reason,
  };
}
