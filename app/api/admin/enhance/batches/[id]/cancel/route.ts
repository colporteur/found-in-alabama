// POST /api/admin/enhance/batches/[id]/cancel — cancel a batch.
// Pending jobs flip to skipped; a job already running finishes its
// current item (single ReviseItem, at most seconds of work).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, enhanceBatches } from "@/db";
import { eq } from "drizzle-orm";
import { cancelBatch } from "@/lib/enhance/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [batch] = await db
    .select()
    .from(enhanceBatches)
    .where(eq(enhanceBatches.id, params.id))
    .limit(1);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }
  if (batch.status === "completed" || batch.status === "cancelled") {
    return NextResponse.json(
      { error: `Batch is already ${batch.status}` },
      { status: 400 }
    );
  }

  await cancelBatch(params.id);
  return NextResponse.json({ ok: true });
}
