// POST /api/admin/enhance/jobs/[id]/rollback — roll back a single job.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, enhanceBatches, enhanceJobs } from "@/db";
import { eq } from "drizzle-orm";
import { rollbackJob } from "@/lib/enhance/rollback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [row] = await db
    .select({ job: enhanceJobs, op: enhanceBatches.op })
    .from(enhanceJobs)
    .innerJoin(enhanceBatches, eq(enhanceJobs.batchId, enhanceBatches.id))
    .where(eq(enhanceJobs.id, params.id))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const result = await rollbackJob(row.job, row.op);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
