// Batch queue engine for the Expert Enhance pipeline (design decision #1:
// queue-first from day one).
//
// Lifecycle:
//   createBatch()  → inserts enhance_batches row + one enhance_jobs row per
//                    listing, both "pending", with a pre-run cost estimate.
//   processTick()  → called by the cron endpoint. Claims and runs pending
//                    jobs one at a time until the time budget is spent.
//                    Claim = optimistic status flip (pending → running),
//                    same pattern as the social publish cron, so overlapping
//                    ticks never double-run a job.
//   cancelBatch()  → flips remaining pending jobs to skipped and the batch
//                    to cancelled. In-flight jobs finish their current run.

import { db, ebayListings, enhanceBatches, enhanceJobs } from "@/db";
import { SUBSTANTIVE_OPS, WIGGLE_OPS, type EnhanceOp } from "@/db/schema";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { getOpHandler } from "@/lib/enhance/ops";

// A job that returns "waiting" (async op in flight, e.g. an APR research
// job) goes back to pending and is re-claimed on a LATER tick — the
// in-tick skip list below prevents a tight submit/poll spin. Each wait
// costs one attempt; past this cap the job fails as timed out.
const MAX_WAIT_ATTEMPTS = 50; // × 5-min ticks ≈ 4 hours

export type CreateBatchParams = {
  op: EnhanceOp;
  label?: string;
  config?: Record<string, unknown>;
  modelOverride?: string | null;
  items: Array<{ ebayItemId: string; sku?: string | null; title?: string | null }>;
};

export async function createBatch(p: CreateBatchParams) {
  const handler = getOpHandler(p.op);
  const perJob = handler
    ? handler.estimateCostPerJob({
        op: p.op,
        config: p.config ?? {},
        modelOverride: p.modelOverride ?? null,
      })
    : 0;
  const estimate = perJob * p.items.length;

  const [batch] = await db
    .insert(enhanceBatches)
    .values({
      op: p.op,
      label: p.label ?? "",
      config: p.config ?? {},
      modelOverride: p.modelOverride ?? null,
      totalJobs: p.items.length,
      estimatedCostUsd: estimate.toFixed(4),
    })
    .returning();

  if (p.items.length > 0) {
    // Chunked insert to stay clear of parameter limits on big batches.
    const CHUNK = 500;
    for (let i = 0; i < p.items.length; i += CHUNK) {
      await db.insert(enhanceJobs).values(
        p.items.slice(i, i + CHUNK).map((it) => ({
          batchId: batch.id,
          ebayItemId: it.ebayItemId,
          sku: it.sku ?? null,
          title: it.title ?? null,
        }))
      );
    }
  }
  return batch;
}

export async function cancelBatch(batchId: string) {
  await db
    .update(enhanceJobs)
    .set({ status: "skipped", errorMessage: "Batch cancelled" })
    .where(and(eq(enhanceJobs.batchId, batchId), eq(enhanceJobs.status, "pending")));
  await db
    .update(enhanceBatches)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(enhanceBatches.id, batchId));
}

export type TickSummary = {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
  /** Jobs re-queued this tick because async work (APR) is still running. */
  waiting: number;
  batchesFinished: number;
  errors: string[];
};

/**
 * Process pending jobs until budgetMs is spent. Runs jobs strictly
 * one-at-a-time (eBay Trading API rate limits + Vercel memory are both
 * happier that way; parallelism can come later if throughput demands it).
 */
export async function processTick(budgetMs: number): Promise<TickSummary> {
  const deadline = Date.now() + budgetMs;
  const summary: TickSummary = {
    processed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    waiting: 0,
    batchesFinished: 0,
    errors: [],
  };
  /** Jobs already touched this tick — never re-claim in the same tick. */
  const seenThisTick: string[] = [];

  while (Date.now() < deadline) {
    // Oldest pending job from the oldest active batch.
    const [next] = await db
      .select({ job: enhanceJobs, batch: enhanceBatches })
      .from(enhanceJobs)
      .innerJoin(enhanceBatches, eq(enhanceJobs.batchId, enhanceBatches.id))
      .where(
        and(
          eq(enhanceJobs.status, "pending"),
          sql`${enhanceBatches.status} IN ('pending', 'running')`,
          seenThisTick.length > 0
            ? notInArray(enhanceJobs.id, seenThisTick)
            : undefined
        )
      )
      .orderBy(asc(enhanceBatches.createdAt), asc(enhanceJobs.createdAt))
      .limit(1);

    if (!next) break; // queue empty (or everything left is waiting)

    const { job, batch } = next;
    seenThisTick.push(job.id);

    // Claim: only proceed if we're the tick that flipped it.
    const claimed = await db
      .update(enhanceJobs)
      .set({
        status: "running",
        attemptCount: (job.attemptCount ?? 0) + 1,
        startedAt: new Date(),
      })
      .where(and(eq(enhanceJobs.id, job.id), eq(enhanceJobs.status, "pending")))
      .returning({ id: enhanceJobs.id });
    if (claimed.length === 0) continue; // another tick got it

    // First claimed job of a pending batch flips the batch to running.
    if (batch.status === "pending") {
      await db
        .update(enhanceBatches)
        .set({ status: "running", startedAt: new Date() })
        .where(and(eq(enhanceBatches.id, batch.id), eq(enhanceBatches.status, "pending")));
    }

    const handler = getOpHandler(batch.op);
    let outcome;
    if (!handler) {
      outcome = {
        status: "failed" as const,
        errorMessage: `No handler registered for op "${batch.op}" (its phase hasn't shipped yet)`,
      };
    } else {
      try {
        outcome = await handler.run(job, batch);
      } catch (err) {
        outcome = {
          status: "failed" as const,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Mirror hygiene: a job that discovered its listing is gone (eBay
    // "Invalid item ID" / "Item not found") or no longer Active becomes
    // a clean skip, and the dead row leaves the mirror so future
    // batches and the workbench stop targeting it. The sync sweep
    // re-adds anything genuinely active.
    const deadByError =
      outcome.status === "failed" &&
      !!outcome.errorMessage &&
      /invalid item|item not found|item cannot be accessed/i.test(outcome.errorMessage);
    const deadByStatus =
      outcome.status === "skipped" &&
      /not Active/.test(String(outcome.result?.reason ?? ""));
    if (deadByError || deadByStatus) {
      await db
        .delete(ebayListings)
        .where(eq(ebayListings.itemId, job.ebayItemId));
      if (deadByError) {
        outcome = {
          status: "skipped" as const,
          result: {
            reason: `Listing gone from eBay — removed from mirror (${outcome.errorMessage?.slice(0, 100)})`,
          },
        };
      }
    }

    // "waiting" = async work in flight (APR job running). Re-queue for a
    // later tick, merging any state the handler stashed (e.g. aprJobId).
    // Batch counters and cost stay untouched until a final outcome.
    if (outcome.status === "waiting") {
      if ((job.attemptCount ?? 0) + 1 > MAX_WAIT_ATTEMPTS) {
        outcome = {
          status: "failed" as const,
          errorMessage: `Timed out after ${MAX_WAIT_ATTEMPTS} wait cycles`,
        };
      } else {
        await db
          .update(enhanceJobs)
          .set({
            status: "pending",
            result: outcome.result ?? job.result ?? null,
          })
          .where(eq(enhanceJobs.id, job.id));
        summary.waiting++;
        continue;
      }
    }

    // Past the waiting branch, only final statuses remain.
    const finalStatus =
      outcome.status === "waiting" ? "failed" : outcome.status;

    await db
      .update(enhanceJobs)
      .set({
        status: finalStatus,
        before: outcome.before ?? null,
        after: outcome.after ?? null,
        result: outcome.result ?? null,
        costUsd: outcome.costUsd !== undefined ? outcome.costUsd.toFixed(6) : null,
        errorMessage: outcome.errorMessage ?? null,
        completedAt: new Date(),
      })
      .where(eq(enhanceJobs.id, job.id));

    // Batch counters + running actual cost, in one atomic update.
    const counterCol =
      outcome.status === "completed"
        ? enhanceBatches.completedJobs
        : outcome.status === "failed"
        ? enhanceBatches.failedJobs
        : enhanceBatches.skippedJobs;
    await db
      .update(enhanceBatches)
      .set({
        [outcome.status === "completed"
          ? "completedJobs"
          : outcome.status === "failed"
          ? "failedJobs"
          : "skippedJobs"]: sql`${counterCol} + 1`,
        actualCostUsd: sql`${enhanceBatches.actualCostUsd} + ${(outcome.costUsd ?? 0).toFixed(6)}`,
      })
      .where(eq(enhanceBatches.id, batch.id));

    // Workbench action tracking: a COMPLETED job stamps the listing's
    // last-wiggle / last-substantive date (skips and failures don't count).
    if (finalStatus === "completed") {
      const stamp = new Date();
      if (WIGGLE_OPS.includes(batch.op)) {
        await db
          .update(ebayListings)
          .set({ lastWiggleAt: stamp })
          .where(eq(ebayListings.itemId, job.ebayItemId));
      } else if (SUBSTANTIVE_OPS.includes(batch.op)) {
        await db
          .update(ebayListings)
          .set({ lastSubstantiveAt: stamp })
          .where(eq(ebayListings.itemId, job.ebayItemId));
      }
    }

    summary.processed++;
    if (outcome.status === "completed") summary.completed++;
    else if (outcome.status === "failed") {
      summary.failed++;
      if (outcome.errorMessage) {
        summary.errors.push(`job ${job.id} (${job.ebayItemId}): ${outcome.errorMessage}`);
      }
    } else summary.skipped++;

    // If that was the batch's last unfinished job, finalize the batch.
    const [remaining] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(enhanceJobs)
      .where(
        and(
          eq(enhanceJobs.batchId, batch.id),
          sql`${enhanceJobs.status} IN ('pending', 'running')`
        )
      );
    if ((remaining?.n ?? 0) === 0) {
      const [fresh] = await db
        .select()
        .from(enhanceBatches)
        .where(eq(enhanceBatches.id, batch.id))
        .limit(1);
      if (fresh && fresh.status === "running") {
        const allFailed = fresh.completedJobs === 0 && fresh.failedJobs > 0;
        await db
          .update(enhanceBatches)
          .set({
            status: allFailed ? "failed" : "completed",
            completedAt: new Date(),
          })
          .where(eq(enhanceBatches.id, batch.id));
        summary.batchesFinished++;
      }
    }
  }

  return summary;
}
