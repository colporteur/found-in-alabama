// Op handler registry for the Expert Enhance pipeline.
//
// Each op (price_adjust, sku_rename, item_specifics, title_remix,
// description_remix, price_research) registers a handler here as its
// phase lands. The batch runner (lib/enhance/queue.ts) looks the handler
// up by op and runs it once per job.
//
// Phase 0 ships an empty registry — creating a batch for an unregistered
// op fails each job with a clear message rather than hanging the queue.

import type { EnhanceOp, enhanceBatches, enhanceJobs } from "@/db/schema";

export type EnhanceBatchRow = typeof enhanceBatches.$inferSelect;
export type EnhanceJobRow = typeof enhanceJobs.$inferSelect;

export type OpOutcome = {
  status: "completed" | "failed" | "skipped";
  /** Field values before the mutation (rollback snapshot). */
  before?: Record<string, unknown>;
  /** Field values after the mutation. */
  after?: Record<string, unknown>;
  /** Op-specific detail (AI reasoning, APR job id, etc.). */
  result?: Record<string, unknown>;
  /** Total spend attributable to this job (sum of its AI/service calls). */
  costUsd?: number;
  errorMessage?: string;
};

export type OpHandler = {
  /** Process one job. Must be idempotent-safe: a retried job re-runs this. */
  run: (job: EnhanceJobRow, batch: EnhanceBatchRow) => Promise<OpOutcome>;
  /** Rough per-job cost for the pre-batch "~$X.XX, proceed?" estimator. */
  estimateCostPerJob: (batch: {
    op: EnhanceOp;
    config: Record<string, unknown>;
    modelOverride: string | null;
  }) => number;
};

export const OP_HANDLERS: Partial<Record<EnhanceOp, OpHandler>> = {
  // Phase 1: price_adjust, sku_rename
  // Phase 2: item_specifics
  // Phase 3: title_remix, description_remix
  // Phase 4: price_research
};

export function getOpHandler(op: string): OpHandler | undefined {
  return OP_HANDLERS[op as EnhanceOp];
}
