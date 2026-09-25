// Read-only feed for Nifty Pick List. Printing never changes fulfillment/delisting.
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gt, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tesOrders, tesOrderItems } from "@/db/schema";
import { bearerFromRequest, verifyApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = bearerFromRequest(req);
  if (!token || !(await verifyApiKey(token))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const after = req.nextUrl.searchParams.get("after");
  const since = req.nextUrl.searchParams.get("since");
  if ((after && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(after)) ||
      (since && !Number.isFinite(Date.parse(since)))) {
    return NextResponse.json({ ok: false, error: "Invalid cursor or start date" }, { status: 400 });
  }
  const rows = await db.select({
    orderId: tesOrders.id, buyerName: tesOrders.shippingName,
    paidAt: tesOrders.paidAt, subtotal: tesOrders.subtotal,
    shipping: tesOrders.shipping, total: tesOrders.total,
  }).from(tesOrders).where(and(
    eq(tesOrders.source, "tes"), eq(tesOrders.status, "paid"),
    after ? gt(tesOrders.id, after) : undefined,
    since ? gte(tesOrders.paidAt, new Date(since)) : undefined,
  )).orderBy(asc(tesOrders.id)).limit(101);
  const orders = rows.slice(0, 100);
  const items = orders.length ? await db.select().from(tesOrderItems)
    .where(inArray(tesOrderItems.orderId, orders.map(o => o.orderId)))
    .orderBy(asc(tesOrderItems.id)) : [];
  return NextResponse.json({
    ok: true,
    orders: orders.map(o => ({ ...o, items: items.filter(i => i.orderId === o.orderId) })),
    nextCursor: rows.length > 100 ? orders[orders.length - 1].orderId : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
