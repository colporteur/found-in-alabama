// POST /api/admin/enhance/jobs/[id]/redo — the "Redo" quick link.
//
// For a bad title/description rewrite: restore the original from the
// before-snapshot (when the job is completed, not yet rolled back, and
// eligible), then create a single-item batch with the ORIGINAL batch's
// op/config/model and run it immediately via a batch-scoped tick — so
// the model re-remixes from the original text, not the bad rewrite,
// and Todd sees the result within seconds.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, enhanceBatches, enhanceJobs } from "@/db";
import { desc, eq } from "drizzle-orm";
import {
  redoEligibility,
  rollbackEligibility,
  rollbackJob,
} from "@/lib/enhance/rollback";
import { createBatch, processTick } from "@/lib/enhance/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leave headroom under maxDuration for the rollback + response. */
const REDO_TICK_BUDGET_MS = 40_000;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [row] = await db
    .select({ job: enhanceJobs, batch: enhanceBatches })
    .from(enhanceJobs)
    .innerJoin(enhanceBatches, eq(enhanceJobs.batchId, enhanceBatches.id))
    .where(eq(enhanceJobs.id, params.id))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const { job, batch } = row;

  const eligible = redoEligibility(job, batch.op);
  if (!eligible.ok) {
    return NextResponse.json({ error: eligible.reason }, { status: 400 });
  }

  // Step 1 — restore the original, so the redo starts from clean text.
  // Skipped when there's nothing to restore (failed job, already rolled
  // back) or the snapshot is ineligible (e.g. truncated description) —
  // in that case the redo proceeds from the current live value.
  let restored = false;
  if (
    job.status === "completed" &&
    !job.rolledBack &&
    rollbackEligibility(job, batch.op).ok
  ) {
    const rb = await rollbackJob(job, batch.op);
    if (!rb.ok) {
      return NextResponse.json(
        { error: `Could not restore the original first: ${rb.error}` },
        { status: 400 }
      );
    }
    restored = true;
  }

  // Step 2 — single-item batch with the original batch's recipe.
  const redoBatch = await createBatch({
    op: batch.op,
    label: `Redo: ${job.sku || job.ebayItemId}`,
    config: batch.config ?? {},
    modelOverride: batch.modelOverride ?? null,
    items: [{ ebayItemId: job.ebayItemId, sku: job.sku, title: job.title }],
  });

  // Link the old job to its redo so the log can show "redone →" and the
  // button doesn't invite accidental double-redos. (Re-read result: the
  // rollback in step 1 may have just rewritten it.)
  const [freshJob] = await db
    .select({ result: enhanceJobs.result })
    .from(enhanceJobs)
    .where(eq(enhanceJobs.id, job.id))
    .limit(1);
  await db
    .update(enhanceJobs)
    .set({
      result: {
        ...((freshJob?.result ?? {}) as Record<string, unknown>),
        redoBatchId: redoBatch.id,
      },
    })
    .where(eq(enhanceJobs.id, job.id));

  // Step 3 — run it now, scoped to this batch only.
  await processTick(REDO_TICK_BUDGET_MS, redoBatch.id);

  // Report the outcome of the redo job.
  const [redoJob] = await db
    .select()
    .from(enhanceJobs)
    .where(eq(enhanceJobs.batchId, redoBatch.id))
    .orderBy(desc(enhanceJobs.createdAt))
    .limit(1);

  return NextResponse.json({
    ok: true,
    restored,
    batchId: redoBatch.id,
    status: redoJob?.status ?? "pending",
    after: redoJob?.after ?? null,
    errorMessage: redoJob?.errorMessage ?? null,
    skipReason:
      redoJob?.result && "reason" in (redoJob.result as Record<string, unknown>)
        ? String((redoJob.result as Record<string, unknown>).reason)
        : null,
  });
}
