// GET /api/admin/tes-orders/pirate-ship?scope=new|unshipped[&mark=0]
//
// Downloads paid, unshipped theephemeralstate.com and foundinalabama.com orders as a CSV for
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
import { tesOrders, tesOrderItems, ebayListings } from "@/db/schema";
import {
  buildPirateShipCsv,
  SHIPPABLE_SOURCES,
  type ExportOrder,
} from "@/lib/tes/pirate-ship";

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
      source: tesOrders.source,
      packageWeightOz: tesOrders.packageWeightOz,
    })
    .from(tesOrders)
    .where(
      and(
        inArray(tesOrders.source, SHIPPABLE_SOURCES),
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
          itemId: tesOrderItems.itemId,
        })
        .from(tesOrderItems)
        .where(inArray(tesOrderItems.orderId, ids))
    : [];

  // FIA orders (Phase FIA-SHOP-1) carry the quoted package weight; a
  // single-unit FIA order also ships in the eBay listing's own box size.
  const itemIds = Array.from(new Set(items.map((i) => i.itemId)));
  const dims = itemIds.length
    ? await db
        .select({
          itemId: ebayListings.itemId,
          l: ebayListings.pkgLengthIn,
          w: ebayListings.pkgWidthIn,
          d: ebayListings.pkgDepthIn,
        })
        .from(ebayListings)
        .where(inArray(ebayListings.itemId, itemIds))
    : [];
  const dimsById = new Map(dims.map((r) => [r.itemId, r]));

  const exportOrders: ExportOrder[] = orders.map((o) => {
    const its = items.filter((i) => i.orderId === o.id);
    const units = its.reduce((n, i) => n + Math.max(1, i.quantity), 0);
    const one = units === 1 ? dimsById.get(its[0].itemId) : undefined;
    const box =
      one && one.l && one.w && one.d
        ? { lengthIn: Number(one.l), widthIn: Number(one.w), heightIn: Number(one.d) }
        : null;
    return {
      id: o.id,
      shippingName: o.shippingName,
      email: o.email,
      shippingAddress: o.shippingAddress,
      source: o.source,
      weightOz: o.packageWeightOz != null ? Number(o.packageWeightOz) : null,
      box,
      items: its,
    };
  });
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
