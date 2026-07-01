// Rollback engine for the Expert Enhance pipeline (decision #4: three
// grains — per item, per batch, per 24h session). Restores the `before`
// snapshot that every op has captured since Phase 1, always via
// ReviseItem, and stamps the job's rolledBack flag.
//
// Op-specific semantics:
// - price_adjust / price_research → restore before.price
// - sku_rename                    → restore before.sku
// - title_remix                   → restore before.title
// - description_remix             → restore before.description, UNLESS the
//   snapshot hit the 20k cap (it may be truncated — writing it back would
//   destroy the tail; those jobs are marked ineligible)
// - item_specifics                → before values were EMPTY, so rollback
//   means REMOVING the specifics we added. Each is only removed if its
//   live value still equals what we wrote — a value Todd edited since
//   stays untouched. (ReviseItem replaces the whole container, so we
//   write the full remaining set.)

import { db, ebayListings, enhanceBatches, enhanceJobs } from "@/db";
import { and, eq, gte, notInArray, sql } from "drizzle-orm";
import {
  fetchItemCore,
  fetchItemForSpecifics,
  reviseItemDescription,
  reviseItemPrice,
  reviseItemSku,
  reviseItemSpecifics,
  reviseItemTitle,
} from "@/lib/ebay/calls";
import type { EnhanceJobRow } from "@/lib/enhance/ops";

/** Must match SNAPSHOT_CAP in lib/enhance/ops.ts (description_remix). */
const DESC_SNAPSHOT_CAP = 20_000;

export type RollbackEligibility =
  | { ok: true }
  | { ok: false; reason: string };

export function rollbackEligibility(
  job: EnhanceJobRow,
  op: string
): RollbackEligibility {
  if (job.status !== "completed") {
    return { ok: false, reason: "Only completed jobs can be rolled back" };
  }
  if (job.rolledBack) return { ok: false, reason: "Already rolled back" };
  const before = job.before ?? {};
  switch (op) {
    case "price_adjust":
    case "price_research":
      if (typeof before.price !== "number") {
        return { ok: false, reason: "No price snapshot" };
      }
      return { ok: true };
    case "sku_rename":
      if (typeof before.sku !== "string") {
        return { ok: false, reason: "No SKU snapshot" };
      }
      return { ok: true };
    case "title_remix":
      if (typeof before.title !== "string" || !before.title) {
        return { ok: false, reason: "No title snapshot" };
      }
      return { ok: true };
    case "description_remix": {
      const desc = before.description;
      if (typeof desc !== "string" || !desc) {
        return { ok: false, reason: "No description snapshot" };
      }
      if (desc.length >= DESC_SNAPSHOT_CAP) {
        return {
          ok: false,
          reason: "Snapshot hit the 20k cap and may be truncated — restore manually",
        };
      }
      return { ok: true };
    }
    case "item_specifics": {
      const after = job.after ?? {};
      if (!after.specifics || typeof after.specifics !== "object") {
        return { ok: false, reason: "No specifics snapshot" };
      }
      return { ok: true };
    }
    default:
      return { ok: false, reason: `Unknown op "${op}"` };
  }
}

export type RollbackResult = { ok: true } | { ok: false; error: string };

/**
 * Roll one job back. Verifies the listing is still Active, applies the
 * op-appropriate restore, syncs the mirror, and flags the job. Errors are
 * recorded on the job (result.rollbackError) and returned.
 */
export async function rollbackJob(
  job: EnhanceJobRow,
  op: string
): Promise<RollbackResult> {
  const eligible = rollbackEligibility(job, op);
  if (!eligible.ok) return { ok: false, error: eligible.reason };
  const before = job.before ?? {};

  try {
    if (op === "item_specifics") {
      // Remove what we added, unless Todd changed it since.
      const live = await fetchItemForSpecifics(job.ebayItemId);
      if (!live) throw new Error("GetItem returned no item");
      if (live.listingStatus && live.listingStatus !== "Active") {
        throw new Error(`Listing status is ${live.listingStatus}, not Active`);
      }
      const wrote = (job.after?.specifics ?? {}) as Record<string, unknown>;
      const removable = new Set(
        Object.entries(wrote)
          .filter(([name, value]) => {
            const current = live.specifics.find(
              (s) => s.name.toLowerCase() === name.toLowerCase()
            );
            return current && current.values.length === 1 && current.values[0] === value;
          })
          .map(([name]) => name.toLowerCase())
      );
      if (removable.size > 0) {
        const remaining = live.specifics.filter(
          (s) => !removable.has(s.name.toLowerCase()) && s.values.length > 0
        );
        await reviseItemSpecifics(job.ebayItemId, remaining);
      }
      // Values already changed by hand count as "nothing left to undo".
    } else {
      const live = await fetchItemCore(job.ebayItemId);
      if (!live) throw new Error("GetItem returned no item");
      if (live.listingStatus && live.listingStatus !== "Active") {
        throw new Error(`Listing status is ${live.listingStatus}, not Active`);
      }

      if (op === "price_adjust" || op === "price_research") {
        const price = before.price as number;
        await reviseItemPrice(job.ebayItemId, price);
        await db
          .update(ebayListings)
          .set({ price: price.toFixed(2) })
          .where(eq(ebayListings.itemId, job.ebayItemId));
      } else if (op === "sku_rename") {
        const sku = before.sku as string;
        await reviseItemSku(job.ebayItemId, sku);
        await db
          .update(ebayListings)
          .set({ sku })
          .where(eq(ebayListings.itemId, job.ebayItemId));
      } else if (op === "title_remix") {
        const title = before.title as string;
        await reviseItemTitle(job.ebayItemId, title);
        await db
          .update(ebayListings)
          .set({ title })
          .where(eq(ebayListings.itemId, job.ebayItemId));
      } else if (op === "description_remix") {
        await reviseItemDescription(job.ebayItemId, before.description as string);
      } else {
        throw new Error(`Unknown op "${op}"`);
      }
    }

    await db
      .update(enhanceJobs)
      .set({
        rolledBack: true,
        result: {
          ...((job.result ?? {}) as Record<string, unknown>),
          rolledBackAt: new Date().toISOString(),
        },
      })
      .where(eq(enhanceJobs.id, job.id));
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db
      .update(enhanceJobs)
      .set({
        result: {
          ...((job.result ?? {}) as Record<string, unknown>),
          rollbackError: error,
        },
      })
      .where(eq(enhanceJobs.id, job.id));
    return { ok: false, error };
  }
}

export type RollbackSliceSummary = {
  processed: number;
  rolledBack: number;
  failed: number;
  ineligible: number;
  remaining: number;
  errors: string[];
};

/**
 * Roll back a set of jobs within a time budget; the client loops until
 * remaining hits 0 (same pattern as the auto-categorize advance flow).
 * Selection is either a batch or a trailing time window across batches.
 */
export async function rollbackSlice(
  scope: { batchId: string } | { sinceHours: number },
  budgetMs: number
): Promise<RollbackSliceSummary> {
  const deadline = Date.now() + budgetMs;
  const summary: RollbackSliceSummary = {
    processed: 0,
    rolledBack: 0,
    failed: 0,
    ineligible: 0,
    remaining: 0,
    errors: [],
  };
  /** Jobs we couldn't roll back this slice — skip when re-querying. */
  const seen: string[] = [];

  const conditions = () =>
    and(
      eq(enhanceJobs.status, "completed"),
      eq(enhanceJobs.rolledBack, false),
      "batchId" in scope
        ? eq(enhanceJobs.batchId, scope.batchId)
        : gte(
            enhanceJobs.completedAt,
            new Date(Date.now() - scope.sinceHours * 3_600_000)
          ),
      seen.length > 0 ? notInArray(enhanceJobs.id, seen) : undefined
    );

  while (Date.now() < deadline) {
    const [next] = await db
      .select({ job: enhanceJobs, op: enhanceBatches.op })
      .from(enhanceJobs)
      .innerJoin(enhanceBatches, eq(enhanceJobs.batchId, enhanceBatches.id))
      .where(conditions())
      .orderBy(enhanceJobs.completedAt)
      .limit(1);
    if (!next) break;

    summary.processed++;
    const eligible = rollbackEligibility(next.job, next.op);
    if (!eligible.ok) {
      summary.ineligible++;
      seen.push(next.job.id);
      continue;
    }
    const res = await rollbackJob(next.job, next.op);
    if (res.ok) {
      summary.rolledBack++;
    } else {
      summary.failed++;
      seen.push(next.job.id);
      summary.errors.push(`${next.job.ebayItemId}: ${res.error}`);
    }
  }

  const [rem] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enhanceJobs)
    .innerJoin(enhanceBatches, eq(enhanceJobs.batchId, enhanceBatches.id))
    .where(conditions());
  summary.remaining = rem?.n ?? 0;
  return summary;
}
