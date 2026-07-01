// POST /api/admin/enhance/batches/[id]/rollback — roll back one time-
// budgeted slice of a batch's completed jobs. The client loops until
// `remaining` reaches 0 (same pattern as auto-categorize's advance).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, enhanceBatches } from "@/db";
import { eq } from "drizzle-orm";
import { rollbackSlice } from "@/lib/enhance/rollback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SLICE_BUDGET_MS = 35_000;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [batch] = await db
    .select({ id: enhanceBatches.id })
    .from(enhanceBatches)
    .where(eq(enhanceBatches.id, params.id))
    .limit(1);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const summary = await rollbackSlice({ batchId: params.id }, SLICE_BUDGET_MS);
  return NextResponse.json(summary);
}
