// Server-side cart resolution for foundinalabama.com checkout (Phase
// FIA-SHOP-1). Mirrors lib/tes/orders.ts: the browser sends only
// { itemId, quantity }; price, discount, weight, service and shipping are
// all rebuilt here from the mirror, so nothing the client sends is
// trusted for money math. Used by both /api/fia/quote and /api/fia/checkout.

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings } from "@/db/schema";
import {
  fiaItemFacts,
  fiaListingColumns,
  loadFiaPricingContext,
  type FiaItemFacts,
} from "@/lib/fia/catalog";
import {
  quoteFiaShipping,
  unitWeight,
  type FiaShippingQuote,
} from "@/lib/fia/shipping";

export type FiaCheckoutLine = { itemId: string; quantity: number };

export type FiaResolvedLine = {
  itemId: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  shipClass: string;
  /** Unit weight used for the quote (oz), eBay's or the class fallback. */
  weightOz: number;
  weightEstimated: boolean;
};

export type FiaCartResolution =
  | {
      ok: true;
      lines: FiaResolvedLine[];
      quote: Extract<FiaShippingQuote, { ok: true }>;
    }
  | {
      ok: false;
      error: string;
      /** Item ids that are sold out / gone / eBay-only (client drops them). */
      unavailable: string[];
    };

export const FIA_MAX_CART_LINES = 20;

export async function resolveFiaCart(
  reqLines: FiaCheckoutLine[]
): Promise<FiaCartResolution> {
  const lines = (reqLines ?? [])
    .filter((l) => l && typeof l.itemId === "string" && /^\d{6,20}$/.test(l.itemId))
    .map((l) => ({
      itemId: l.itemId,
      quantity: Math.max(1, Math.min(99, Math.floor(Number(l.quantity) || 1))),
    }));

  if (lines.length === 0) {
    return { ok: false, error: "Cart is empty.", unavailable: [] };
  }
  if (lines.length > FIA_MAX_CART_LINES) {
    return {
      ok: false,
      error: `Carts are limited to ${FIA_MAX_CART_LINES} different items — split the order in two.`,
      unavailable: [],
    };
  }

  const [rows, ctx] = await Promise.all([
    db
      .select(fiaListingColumns)
      .from(ebayListings)
      .where(inArray(ebayListings.itemId, lines.map((l) => l.itemId))),
    loadFiaPricingContext(),
  ]);
  const byId = new Map(rows.map((r) => [r.itemId, r]));

  const unavailable: string[] = [];
  const facts: { f: FiaItemFacts; quantity: number }[] = [];
  for (const line of lines) {
    const r = byId.get(line.itemId);
    const f = r ? fiaItemFacts(r, ctx) : null;
    if (!f || f.quantity < line.quantity || !f.directSale) {
      unavailable.push(line.itemId);
      continue;
    }
    facts.push({ f, quantity: line.quantity });
  }

  if (unavailable.length > 0) {
    return {
      ok: false,
      error:
        unavailable.length === 1
          ? "One item in your cart is no longer available here and has been removed."
          : `${unavailable.length} items in your cart are no longer available here and have been removed.`,
      unavailable,
    };
  }

  const quote = quoteFiaShipping(
    facts.map(({ f, quantity }) => ({ ...f.ship, quantity, price: f.price })),
    ctx.settings
  );
  if (!quote.ok) {
    return { ok: false, error: quote.error, unavailable: [] };
  }

  return {
    ok: true,
    quote,
    lines: facts.map(({ f, quantity }) => {
      const w = unitWeight(f.ship, ctx.settings);
      return {
        itemId: f.itemId,
        title: f.title,
        sku: f.sku,
        imageUrl: f.imageUrl,
        unitPrice: f.price,
        quantity,
        shipClass: f.ship.shipClass,
        weightOz: w.oz,
        weightEstimated: w.estimated,
      };
    }),
  };
}
