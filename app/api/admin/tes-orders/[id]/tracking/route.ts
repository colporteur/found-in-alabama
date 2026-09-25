// POST /api/admin/tes-orders/[id]/tracking
// Body: { tracking: string | null, carrier?: string | null }
//    or: { skip: true }
// Manual set / clear of an order's tracking (Phase SHIP-1) — for a label
// bought outside the spreadsheet flow, or to undo a wrong import match.
// skip marks the order "not shipping" (test orders, pickups): shipped_at
// is set with no tracking so the Pirate Ship export never includes it.
// Clearing ({ tracking: null }) resets both. Admin-session gated.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { tesOrders } from "@/db/schema";
import { guessCarrier, NOT_SHIPPING } from "@/lib/tes/pirate-ship";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let tracking: string | null = null;
  let carrier: string | null = null;
  let skip = false;
  try {
    const body = (await req.json()) as { tracking?: unknown; carrier?: unknown; skip?: unknown };
    skip = body.skip === true;
    tracking = typeof body.tracking === "string" ? body.tracking.replace(/\s+/g, "") || null : null;
    carrier = typeof body.carrier === "string" ? body.carrier.trim() || null : null;
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 });
  }
  if (tracking && !/^[0-9A-Za-z]{8,40}$/.test(tracking)) {
    return NextResponse.json({ ok: false, error: "That doesn't look like a tracking number" }, { status: 400 });
  }
  const updated = await db
    .update(tesOrders)
    .set(
      skip
        ? { trackingNumber: null, carrier: NOT_SHIPPING, shippedAt: new Date() }
        : tracking
        ? { trackingNumber: tracking, carrier: carrier ?? guessCarrier(tracking), shippedAt: new Date() }
        : { trackingNumber: null, carrier: null, shippedAt: null }
    )
    .where(and(eq(tesOrders.id, params.id), eq(tesOrders.source, "tes")))
    .returning({ id: tesOrders.id });
  if (updated.length === 0) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
