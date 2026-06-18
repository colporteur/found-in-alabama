// Auto-categorize orchestrator. Replaces the old review-queue flow.
//
// Design:
//   - At run start, we snapshot the full set of eligible items (Other-only
//     for primary phase, has-1-no-2 for secondary phase) into the run's
//     `queue` jsonb column. No persistent listings table.
//   - Old runs and their categorization rows get hard-deleted on a new
//     start so the UI always reflects "just this run".
//   - The client calls /advance once per item. Each /advance call is short
//     (one Claude call + one eBay ReviseItem). The client paces them with
//     a ~2-second gap so Todd can eyeball progress and bail with stop.
//   - Items that have ended (sold or expired) since the snapshot are
//     caught by eBay's error response and marked `ebay_ended`. We don't
//     pre-filter because there's no live "is this still active" call
//     cheap enough to be worth it.

import { db } from "@/db";
import {
  ebayAutoCategorizations,
  ebayAutoCategorizeRuns,
  ebayListings,
  ebayStoreCategories,
} from "@/db/schema";
import { and, desc, eq, gt, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { fetchStoreCategoryTree, flattenCategoryTree, iterateActiveListings, reviseStoreCategories } from "./calls";
import { suggestCategoryForListing } from "./categorize";

export type RunPhase = "primary" | "secondary";

export interface QueueItem {
  itemId: string;
  title: string;
  primaryImageUrl: string | null;
  price: string | null;
  storeCategory1Id: string | null;
  storeCategory2Id: string | null;
}

/**
 * Look up the "Other" store category id. The eBay tool flags exactly one
 * category as the Other bucket during the sync step.
 */
export async function getOtherCategoryId(): Promise<string | null> {
  const [row] = await db
    .select({ categoryId: ebayStoreCategories.categoryId })
    .from(ebayStoreCategories)
    .where(eq(ebayStoreCategories.isOtherBucket, true))
    .limit(1);
  return row?.categoryId ?? null;
}

/**
 * Get the count of items currently eligible for the given phase, fresh
 * from eBay. Used for the dashboard count and the initial queue size.
 */
export async function countEligibleItems(phase: RunPhase): Promise<number> {
  const otherId = await getOtherCategoryId();
  if (!otherId) {
    throw new Error("Other category not found. Run a category sync first.");
  }
  const items = await collectEligibleItems(phase, otherId);
  return items.length;
}

/**
 * Pull every active listing matching the phase filter into memory. For
 * the typical Found in Alabama store (~5k active items, a few hundred in
 * Other) this is fine. If the catalog grows past ~20k we'd want to page
 * through and write the queue incrementally.
 */
export async function collectEligibleItems(
  phase: RunPhase,
  otherCategoryId: string
): Promise<QueueItem[]> {
  // Query the local ebay_listings mirror (maintained by the weekly
  // sync-listings cron) instead of walking eBay's API live. A live walk
  // hits Vercel's 60s gateway on stores ~5k+ items; the mirror is one
  // indexed SELECT and finishes in ~100ms.
  //
  // Caveat: items listed since the last sync won't appear here. They'll
  // be picked up on the next run. For maximum freshness, trigger
  // .github/workflows/sync-listings-cron.yml via workflow_dispatch before
  // starting a categorize run.

  console.log(
    `[auto-cat:collect] phase=${phase} otherCategoryId=${otherCategoryId} (mirror)`
  );

  const baseSelect = {
    itemId: ebayListings.itemId,
    title: ebayListings.title,
    primaryImageUrl: ebayListings.primaryImageUrl,
    price: ebayListings.price,
    storeCategory1Id: ebayListings.storeCategory1Id,
    storeCategory2Id: ebayListings.storeCategory2Id,
  };

  let rows: QueueItem[];
  if (phase === "primary") {
    rows = await db
      .select(baseSelect)
      .from(ebayListings)
      .where(
        and(
          eq(ebayListings.storeCategory1Id, otherCategoryId),
          gt(ebayListings.quantity, 0)
        )
      );
    console.log(`[auto-cat:collect] PRIMARY matched=${rows.length}`);
  } else {
    // secondary: has a primary store cat that's NOT Other, but no second cat
    rows = await db
      .select(baseSelect)
      .from(ebayListings)
      .where(
        and(
          ne(ebayListings.storeCategory1Id, otherCategoryId),
          isNull(ebayListings.storeCategory2Id),
          gt(ebayListings.quantity, 0)
        )
      );
    console.log(`[auto-cat:collect] SECONDARY matched=${rows.length}`);
  }

  return rows;
}

/**
 * Create a new run row. Wipes any prior run + categorization rows so the
 * UI shows just the current activity.
 */
export async function startRun(phase: RunPhase, queue: QueueItem[]) {
  // Delete prior runs (cascade removes their categorizations)
  await db.delete(ebayAutoCategorizeRuns);

  const [run] = await db
    .insert(ebayAutoCategorizeRuns)
    .values({
      phase,
      status: "running",
      initialQueueCount: queue.length,
      queue,
      queueIndex: 0,
    })
    .returning();

  return run;
}

/**
 * Build the list of store-category options Claude can pick from.
 * Excludes the Other bucket itself (no point suggesting Other → Other)
 * and de-duplicates by id.
 */
export async function buildCategoryOptions() {
  const rows = await db
    .select({
      id: ebayStoreCategories.categoryId,
      name: ebayStoreCategories.name,
      isAlabama: ebayStoreCategories.isAlabamaRelated,
      isOtherBucket: ebayStoreCategories.isOtherBucket,
    })
    .from(ebayStoreCategories);

  return rows
    .filter((r) => !r.isOtherBucket)
    .map((r) => ({ id: r.id, name: r.name, isAlabama: r.isAlabama }));
}

/**
 * Process one item from the run's queue. Returns the resulting
 * categorization row plus a flag indicating whether the queue is now
 * exhausted (the caller can use this to flip the run status to
 * `completed`).
 *
 * Throws only on truly unrecoverable errors (DB connection lost, etc.).
 * Per-item failures (Claude, eBay) are caught and persisted as
 * categorization rows with the appropriate outcome.
 */
export async function processNext(runId: string): Promise<{
  done: boolean;
  processedItemId: string | null;
  outcome: string | null;
}> {
  const [run] = await db
    .select()
    .from(ebayAutoCategorizeRuns)
    .where(eq(ebayAutoCategorizeRuns.id, runId))
    .limit(1);

  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== "running") {
    return { done: true, processedItemId: null, outcome: null };
  }

  const queue = run.queue as QueueItem[];
  if (run.queueIndex >= queue.length) {
    // Already done — flip to completed
    await db
      .update(ebayAutoCategorizeRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(ebayAutoCategorizeRuns.id, runId));
    return { done: true, processedItemId: null, outcome: null };
  }

  const item = queue[run.queueIndex];

  // Advance the queueIndex first so a crash mid-item doesn't reprocess
  // the same one.
  await db
    .update(ebayAutoCategorizeRuns)
    .set({
      queueIndex: run.queueIndex + 1,
      totalAttempted: sql`${ebayAutoCategorizeRuns.totalAttempted} + 1`,
    })
    .where(eq(ebayAutoCategorizeRuns.id, runId));

  const categories = await buildCategoryOptions();
  const otherId = await getOtherCategoryId();

  // Ask Claude
  let suggestion;
  try {
    suggestion = await suggestCategoryForListing({
      title: item.title,
      categories,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Claude call failed";
    await recordOutcome(runId, item, {
      outcome: "claude_failed",
      errorMessage: msg,
    });
    await db
      .update(ebayAutoCategorizeRuns)
      .set({ totalFailed: sql`${ebayAutoCategorizeRuns.totalFailed} + 1` })
      .where(eq(ebayAutoCategorizeRuns.id, runId));
    return {
      done: run.queueIndex + 1 >= queue.length,
      processedItemId: item.itemId,
      outcome: "claude_failed",
    };
  }

  // Determine which categories to push. For primary phase, picked
  // category1 must NOT be Other. For secondary phase, we keep the
  // existing category1 and only push category2.
  const isPrimary = run.phase === "primary";
  let pushCategory1: string;
  let pushCategory2: string | null = null;

  if (isPrimary) {
    if (!suggestion.primaryCategoryId || suggestion.primaryCategoryId === otherId) {
      // No good pick — record as skipped, don't push anything
      await recordOutcome(runId, item, {
        outcome: "skipped",
        errorMessage: "Claude returned no usable category",
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
      });
      await db
        .update(ebayAutoCategorizeRuns)
        .set({ totalSkipped: sql`${ebayAutoCategorizeRuns.totalSkipped} + 1` })
        .where(eq(ebayAutoCategorizeRuns.id, runId));
      return {
        done: run.queueIndex + 1 >= queue.length,
        processedItemId: item.itemId,
        outcome: "skipped",
      };
    }
    pushCategory1 = suggestion.primaryCategoryId;
    // Leave existing Cat 2 alone. The whole point of primary phase is to
    // move items out of Other (Cat 1). If they already have a Cat 2 from
    // the old tool, keep it; if they don't, secondary phase can fill it
    // in later. Pass null to reviseStoreCategories → eBay preserves the
    // current Cat 2 value.
    pushCategory2 = null;
  } else {
    if (!suggestion.primaryCategoryId) {
      await recordOutcome(runId, item, {
        outcome: "skipped",
        errorMessage: "Claude returned no usable 2nd category",
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
      });
      await db
        .update(ebayAutoCategorizeRuns)
        .set({ totalSkipped: sql`${ebayAutoCategorizeRuns.totalSkipped} + 1` })
        .where(eq(ebayAutoCategorizeRuns.id, runId));
      return {
        done: run.queueIndex + 1 >= queue.length,
        processedItemId: item.itemId,
        outcome: "skipped",
      };
    }
    pushCategory1 = item.storeCategory1Id!; // existing
    pushCategory2 = suggestion.primaryCategoryId; // Claude's pick goes in slot 2
  }

  // Look up the picked categories' names + Alabama flag
  const catLookup = new Map(categories.map((c) => [c.id, c]));
  const cat1 = catLookup.get(pushCategory1);
  const cat2 = pushCategory2 ? catLookup.get(pushCategory2) : null;
  const isAlabamaPick = !!(cat1?.isAlabama || cat2?.isAlabama);

  // Push to eBay
  try {
    await reviseStoreCategories(item.itemId, pushCategory1, pushCategory2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ReviseItem failed";
    const isEnded =
      msg.toLowerCase().includes("ended") ||
      msg.toLowerCase().includes("not active") ||
      msg.includes("21916757") ||
      msg.includes("21916984");
    await recordOutcome(runId, item, {
      outcome: isEnded ? "ebay_ended" : "ebay_failed",
      errorMessage: msg,
      pickedCategory1Id: pushCategory1,
      pickedCategory1Name: cat1?.name,
      pickedCategory2Id: pushCategory2,
      pickedCategory2Name: cat2?.name,
      confidence: suggestion.confidence,
      reasoning: suggestion.reasoning,
      isAlabamaPick,
    });
    await db
      .update(ebayAutoCategorizeRuns)
      .set({ totalFailed: sql`${ebayAutoCategorizeRuns.totalFailed} + 1` })
      .where(eq(ebayAutoCategorizeRuns.id, runId));
    return {
      done: run.queueIndex + 1 >= queue.length,
      processedItemId: item.itemId,
      outcome: isEnded ? "ebay_ended" : "ebay_failed",
    };
  }

  // Success!
  await recordOutcome(runId, item, {
    outcome: "applied",
    pickedCategory1Id: pushCategory1,
    pickedCategory1Name: cat1?.name,
    pickedCategory2Id: pushCategory2,
    pickedCategory2Name: cat2?.name,
    confidence: suggestion.confidence,
    reasoning: suggestion.reasoning,
    isAlabamaPick,
  });
  await db
    .update(ebayAutoCategorizeRuns)
    .set({ totalApplied: sql`${ebayAutoCategorizeRuns.totalApplied} + 1` })
    .where(eq(ebayAutoCategorizeRuns.id, runId));

  const done = run.queueIndex + 1 >= queue.length;
  if (done) {
    await db
      .update(ebayAutoCategorizeRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(ebayAutoCategorizeRuns.id, runId));
  }

  return { done, processedItemId: item.itemId, outcome: "applied" };
}

interface OutcomeFields {
  outcome:
    | "applied"
    | "ebay_failed"
    | "ebay_ended"
    | "claude_failed"
    | "skipped";
  pickedCategory1Id?: string | null;
  pickedCategory1Name?: string | null;
  pickedCategory2Id?: string | null;
  pickedCategory2Name?: string | null;
  confidence?: number;
  reasoning?: string;
  isAlabamaPick?: boolean;
  errorMessage?: string;
}

async function recordOutcome(
  runId: string,
  item: QueueItem,
  fields: OutcomeFields
): Promise<void> {
  await db.insert(ebayAutoCategorizations).values({
    runId,
    itemId: item.itemId,
    title: item.title,
    primaryImageUrl: item.primaryImageUrl,
    price: item.price,
    pickedCategory1Id: fields.pickedCategory1Id ?? null,
    pickedCategory1Name: fields.pickedCategory1Name ?? null,
    pickedCategory2Id: fields.pickedCategory2Id ?? null,
    pickedCategory2Name: fields.pickedCategory2Name ?? null,
    isAlabamaPick: fields.isAlabamaPick ?? false,
    confidence:
      fields.confidence !== undefined ? String(fields.confidence) : null,
    reasoning: fields.reasoning ?? null,
    outcome: fields.outcome,
    errorMessage: fields.errorMessage ?? null,
  });
}

/**
 * Fetch the latest run (running or recently completed) for the dashboard
 * to display. Returns null if no run exists yet.
 */
export async function getLatestRun() {
  const [run] = await db
    .select()
    .from(ebayAutoCategorizeRuns)
    .orderBy(desc(ebayAutoCategorizeRuns.startedAt))
    .limit(1);
  return run ?? null;
}

/**
 * Fetch categorization rows for a run, newest first.
 */
export async function getRunCategorizations(runId: string, limit = 500) {
  return db
    .select()
    .from(ebayAutoCategorizations)
    .where(eq(ebayAutoCategorizations.runId, runId))
    .orderBy(desc(ebayAutoCategorizations.decidedAt))
    .limit(limit);
}
