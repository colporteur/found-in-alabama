// GET /api/tes/delist-queue — work queue for the TES delist Chrome
// extension. Auth: Bearer <api key> (same keys as /admin/api-keys).
//
// Returns paid orders whose delistStatus is "pending", each with its
// items and the item's CURRENT mirror quantity (post-webhook decrement).
// remainingQty > 0 means other units are still for sale — the extension
// must NOT delist those in Nifty (delisting kills all quantity
// everywhere); they're flagged for manual quantity reduction instead.

import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tesOrders, tesOrderItems, ebayListings } from "@/db/schema";
import { bearerFromRequest, verifyApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = bearerFromRequest(req);
  const key = token ? await verifyApiKey(token) : null;
  if (!key) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const orders = await db
    .select()
    .from(tesOrders)
    .where(and(eq(tesOrders.status, "paid"), eq(tesOrders.delistStatus, "pending")))
    .limit(10);

  if (orders.length === 0) {
    return NextResponse.json({ ok: true, orders: [] });
  }

  const orderIds = orders.map((o) => o.id);
  const items = await db
    .select()
    .from(tesOrderItems)
    .where(inArray(tesOrderItems.orderId, orderIds));

  // Current mirror quantity per eBay item (post-decrement).
  const itemIds = [...new Set(items.map((i) => i.itemId))];
  const listings = itemIds.length
    ? await db
        .select({ itemId: ebayListings.itemId, quantity: ebayListings.quantity })
        .from(ebayListings)
        .where(inArray(ebayListings.itemId, itemIds))
    : [];
  const qtyById = new Map(listings.map((l) => [l.itemId, l.quantity ?? 0]));

  return NextResponse.json({
    ok: true,
    orders: orders.map((o) => ({
      orderId: o.id,
      paidAt: o.paidAt,
      buyerName: o.shippingName,
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => ({
          itemId: i.itemId,
          title: i.title,
          sku: i.sku,
          quantitySold: i.quantity,
          remainingQty: qtyById.get(i.itemId) ?? 0,
        })),
    })),
  });
}
