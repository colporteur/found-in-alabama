// Server-side cart resolution for TES checkout. The client cart is
// display-only — this module rebuilds every line from the mirror
// (price, sale discount, ship class, availability) so nothing the
// browser sends is trusted for money math.

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, ebayStoreCategories } from "@/db/schema";
import { getOnSaleLookup } from "@/lib/ebay/active-sales";
import {
  bestDiscountPercent,
  discountedPrice,
  getTesDiscountPercent,
} from "@/lib/tes/discount";
import {
  maxShipClass,
  normalizeShipClass,
  quoteShipping,
  type ShipClass,
  type ShippingQuote,
} from "@/lib/tes/shipping";

export type CheckoutRequestLine = { itemId: string; quantity: number };

export type ResolvedLine = {
  itemId: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  /** Final unit price in dollars (sale discount applied). */
  unitPrice: number;
  quantity: number;
  shipClass: ShipClass;
};

export type CartResolution =
  | {
      ok: true;
      lines: ResolvedLine[];
      quote: ShippingQuote;
    }
  | {
      ok: false;
      error: string;
      /** Item ids that are sold out / gone (client should drop them). */
      unavailable: string[];
    };

export const MAX_CART_LINES = 20;

export async function resolveCart(
  reqLines: CheckoutRequestLine[]
): Promise<CartResolution> {
  const lines = (reqLines ?? [])
    .filter((l) => l && typeof l.itemId === "string")
    .map((l) => ({
      itemId: l.itemId,
      quantity: Math.max(1, Math.min(99, Math.floor(Number(l.quantity) || 1))),
    }));

  if (lines.length === 0) {
    return { ok: false, error: "Cart is empty.", unavailable: [] };
  }
  if (lines.length > MAX_CART_LINES) {
    return {
      ok: false,
      error: `Carts are limited to ${MAX_CART_LINES} distinct items — split the order in two.`,
      unavailable: [],
    };
  }

  const ids = lines.map((l) => l.itemId);
  const [rows, cats, onSale, flatPct] = await Promise.all([
    db
      .select({
        itemId: ebayListings.itemId,
        title: ebayListings.title,
        sku: ebayListings.sku,
        price: ebayListings.price,
        quantity: ebayListings.quantity,
        imageUrl: ebayListings.primaryImageUrl,
        cat1: ebayListings.storeCategory1Id,
        cat2: ebayListings.storeCategory2Id,
      })
      .from(ebayListings)
      .where(inArray(ebayListings.itemId, ids)),
    db
      .select({
        categoryId: ebayStoreCategories.categoryId,
        shipClass: ebayStoreCategories.shipClass,
      })
      .from(ebayStoreCategories),
    getOnSaleLookup(),
    getTesDiscountPercent(),
  ]);

  const byId = new Map(rows.map((r) => [r.itemId, r]));
  const classByCat = new Map(cats.map((c) => [c.categoryId, c.shipClass]));

  const unavailable: string[] = [];
  const resolved: ResolvedLine[] = [];

  for (const line of lines) {
    const r = byId.get(line.itemId);
    const price = r?.price != null ? parseFloat(r.price) : NaN;
    if (!r || !Number.isFinite(price) || (r.quantity ?? 0) < line.quantity) {
      unavailable.push(line.itemId);
      continue;
    }
    // Sale discount: per-listing badge wins, else either store category.
    // The store-wide flat discount competes with the badge — the larger
    // percentage applies, never both.
    const badge =
      onSale.byListingId.get(r.itemId) ??
      (r.cat1 ? onSale.byCategoryId.get(r.cat1) : undefined) ??
      (r.cat2 ? onSale.byCategoryId.get(r.cat2) : undefined) ??
      null;
    const pct = bestDiscountPercent(flatPct, badge?.discountPercent);
    const unitPrice = discountedPrice(price, pct);
    const c1 = normalizeShipClass(r.cat1 ? classByCat.get(r.cat1) : undefined);
    const c2 = normalizeShipClass(r.cat2 ? classByCat.get(r.cat2) : undefined);
    resolved.push({
      itemId: r.itemId,
      title: r.title,
      sku: r.sku,
      imageUrl: r.imageUrl,
      unitPrice,
      quantity: line.quantity,
      shipClass: maxShipClass(c1, c2),
    });
  }

  if (unavailable.length > 0) {
    return {
      ok: false,
      error:
        unavailable.length === 1
          ? "One item in your cart just sold and has been removed."
          : `${unavailable.length} items in your cart just sold and have been removed.`,
      unavailable,
    };
  }

  const quote = quoteShipping(
    resolved.map((l) => ({
      shipClass: l.shipClass,
      quantity: l.quantity,
      price: l.unitPrice,
    }))
  );

  return { ok: true, lines: resolved, quote };
}
