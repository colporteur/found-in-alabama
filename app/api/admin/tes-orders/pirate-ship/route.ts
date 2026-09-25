// GET /api/admin/tes-orders/pirate-ship?scope=new|unshipped[&mark=0]
//
// Downloads paid, unshipped theephemeralstate.com orders as a CSV for
// Pirate Ship's "Upload a spreadsheet" (Phase SHIP-1).
//   scope=new        (default) only orders never exported before
//   scope=unshipped  every paid order without tracking yet (re-export)
//   mark=0           don't stamp pirate_exported_at (preview)
// HipPostcard orders (source = "hip") are excluded: Hip holds their
// addresses, not us. Admin-session gated.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { tesOrders, tesOrderItems } from "@/db/schema";
import { buildPirateShipCsv, type ExportOrder } from "@/lib/tes/pirate-ship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const scope = req.nextUrl.searchParams.get("scope") === "unshipped" ? "unshipped" : "new";
  const mark = req.nextUrl.searchParams.get("mark") !== "0";

  const orders = await db
    .select({
      id: tesOrders.id,
      shippingName: tesOrders.shippingName,
      email: tesOrders.email,
      shippingAddress: tesOrders.shippingAddress,
    })
    .from(tesOrders)
    .where(
      and(
        eq(tesOrders.source, "tes"),
        eq(tesOrders.status, "paid"),
        isNull(tesOrders.shippedAt),
        isNotNull(tesOrders.shippingAddress),
        scope === "new" ? isNull(tesOrders.pirateExportedAt) : undefined
      )
    )
    .orderBy(asc(tesOrders.paidAt))
    .limit(500);

  const ids = orders.map((o) => o.id);
  const items = ids.length
    ? await db
        .select({
          orderId: tesOrderItems.orderId,
          sku: tesOrderItems.sku,
          title: tesOrderItems.title,
          quantity: tesOrderItems.quantity,
          shipClass: tesOrderItems.shipClass,
        })
        .from(tesOrderItems)
        .where(inArray(tesOrderItems.orderId, ids))
    : [];

  const exportOrders: ExportOrder[] = orders.map((o) => ({
    ...o,
    items: items.filter((i) => i.orderId === o.id),
  }));
  const csv = buildPirateShipCsv(exportOrders);

  if (mark && ids.length > 0) {
    await db
      .update(tesOrders)
      .set({ pirateExportedAt: new Date() })
      .where(inArray(tesOrders.id, ids));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tes-pirate-ship-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Order-Count": String(ids.length),
    },
  });
}
