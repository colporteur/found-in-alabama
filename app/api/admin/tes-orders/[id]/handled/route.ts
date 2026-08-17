// POST /api/admin/tes-orders/[id]/handled
// Body: { handled: boolean } — flip an order's delistStatus between
// "pending" and "done". Admin-session gated.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { tesOrders } from "@/db/schema";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let handled = true;
  try {
    const body = (await req.json()) as { handled?: boolean };
    handled = body.handled !== false;
  } catch {
    // default true
  }
  const updated = await db
    .update(tesOrders)
    .set({ delistStatus: handled ? "done" : "pending" })
    .where(eq(tesOrders.id, params.id))
    .returning({ id: tesOrders.id });
  if (updated.length === 0) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
