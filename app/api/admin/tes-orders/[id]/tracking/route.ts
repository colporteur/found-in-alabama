// POST /api/admin/tes-orders/[id]/tracking
// Body: { tracking: string | null, carrier?: string | null }
// Manual set / clear of an order's tracking (Phase SHIP-1) — for a label
// bought outside the spreadsheet flow, or to undo a wrong import match.
// Clearing also clears shipped_at. Admin-session gated.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { tesOrders } from "@/db/schema";
import { guessCarrier } from "@/lib/tes/pirate-ship";

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
  try {
    const body = (await req.json()) as { tracking?: unknown; carrier?: unknown };
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
      tracking
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
