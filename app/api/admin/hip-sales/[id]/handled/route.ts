// POST /api/admin/hip-sales/[id]/handled — Phase HIP-1.
// Body: { handled: boolean } — Todd acknowledges a Hip sale decision on
// the Delist board (cancel_hip done on Hip, manual line dealt with).
// Admin-session gated. [id] is the Hip sale id.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { hipSales } from "@/db/schema";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ ok: false, error: "Bad id" }, { status: 400 });
  }
  let handled = true;
  try {
    const body = (await req.json()) as { handled?: boolean };
    handled = body.handled !== false;
  } catch {
    // default true
  }
  const updated = await db
    .update(hipSales)
    .set({ handledAt: handled ? new Date() : null })
    .where(eq(hipSales.hipSaleId, id))
    .returning({ id: hipSales.hipSaleId });
  if (updated.length === 0) {
    return NextResponse.json({ ok: false, error: "Sale not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
