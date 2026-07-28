// Autorun price bump — a standing background process that slowly cycles
// the whole inventory, nudging each price by a random ±amount around its
// stored anchor (ebay_listings.price_anchor, managed by the price_wiggle
// op in ops.ts).
//
// How it runs: the enhance cron tick calls autorunTick() before the normal
// queue tick. While an autorun is active, the tick keeps a small buffer of
// LOW-PRIORITY price_wiggle slice batches queued; the queue only claims
// low-priority jobs when nothing normal is pending, so autorun never
// starves interactive batches.
//
// Cycle bookkeeping: an item "counts" for the current cycle the moment it
// is SELECTED into a slice (lastAutorunAt is stamped at selection, not
// completion) — that keeps cycle accounting immune to skips/failures. An
// item is eligible for selection when it hasn't been selected this cycle
// AND its last selection is older than minDaysBetween days (the pacing
// guard, which also throttles back-to-back cycles). When nothing is
// eligible and nothing is in flight: if items are merely throttled the
// tick waits; otherwise the cycle is complete — bump cycleCount, stop if
// maxCycles is reached, else start the next cycle.

import {
  db,
  ebayListings,
  enhanceAutoruns,
  enhanceBatches,
  enhanceJobs,
} from "@/db";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { cancelBatch, createBatch } from "@/lib/enhance/queue";

/** Items per slice batch. */
const SLICE_SIZE = 100;
/** Refill when outstanding autorun jobs drop below this. */
const REFILL_THRESHOLD = 20;

export type AutorunRow = typeof enhanceAutoruns.$inferSelect;

export type StartAutorunParams = {
  /** Max absolute wiggle in dollars, e.g. 0.05 → ±5¢. */
  amount: number;
  floor?: number;
  minDaysBetween?: number;
  /** Null/undefined = run until stopped manually. */
  maxCycles?: number | null;
};

export type StartAutorunResult =
  | { ok: true; autorun: AutorunRow }
  | { ok: false; error: string };

export async function startAutorun(
  p: StartAutorunParams
): Promise<StartAutorunResult> {
  const amount = Number(p.amount);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 5) {
    return { ok: false, error: "Amount must be between 0.01 and 5.00" };
  }
  const floor = p.floor !== undefined ? Number(p.floor) : 0.99;
  if (!Number.isFinite(floor) || floor < 0.01) {
    return { ok: false, error: "Floor must be at least 0.01" };
  }
  const minDays = p.minDaysBetween !== undefined ? Number(p.minDaysBetween) : 4;
  if (!Number.isInteger(minDays) || minDays < 1 || minDays > 60) {
    return { ok: false, error: "Min days between must be a whole number 1–60" };
  }
  let maxCycles: number | null = null;
  if (p.maxCycles !== undefined && p.maxCycles !== null) {
    maxCycles = Number(p.maxCycles);
    if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 1000) {
      return { ok: false, error: "Max cycles must be a whole number 1–1000 (or blank)" };
    }
  }

  const [existing] = await db
    .select({ id: enhanceAutoruns.id })
    .from(enhanceAutoruns)
    .where(eq(enhanceAutoruns.status, "running"))
    .limit(1);
  if (existing) {
    return { ok: false, error: "An autorun is already running — stop it first" };
  }

  const [autorun] = await db
    .insert(enhanceAutoruns)
    .values({
      amount: amount.toFixed(2),
      floor: floor.toFixed(2),
      minDaysBetween: minDays,
      maxCycles,
    })
    .returning();
  return { ok: true, autorun };
}

export type StopAutorunResult =
  | { ok: true; batchesCancelled: number }
  | { ok: false; error: string };

/** Stop the active autorun and cancel its queued slice batches. */
export async function stopAutorun(): Promise<StopAutorunResult> {
  const [run] = await db
    .select()
    .from(enhanceAutoruns)
    .where(eq(enhanceAutoruns.status, "running"))
    .limit(1);
  if (!run) return { ok: false, error: "No autorun is running" };

  await db
    .update(enhanceAutoruns)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(enhanceAutoruns.id, run.id));

  const openBatches = await db
    .select({ id: enhanceBatches.id })
    .from(enhanceBatches)
    .where(
      and(
        eq(enhanceBatches.op, "price_wiggle"),
        sql`${enhanceBatches.status} IN ('pending', 'running')`,
        sql`${enhanceBatches.config}->>'autorunId' = ${run.id}`
      )
    );
  for (const b of openBatches) {
    await cancelBatch(b.id);
  }
  return { ok: true, batchesCancelled: openBatches.length };
}

export type AutorunTickResult = {
  autorunId: string;
  refilled: number;
  outstanding: number;
  /** Items still owed this cycle but inside the minDaysBetween window. */
  throttled?: number;
  cycleCompleted?: number;
  finished?: boolean;
};

/**
 * Keep the active autorun fed. Called by the enhance cron tick (cheap
 * no-op when no autorun is running). Never throws work-stopping errors up
 * to the queue — the caller wraps it in try/catch.
 */
export async function autorunTick(): Promise<AutorunTickResult | null> {
  const [run] = await db
    .select()
    .from(enhanceAutoruns)
    .where(eq(enhanceAutoruns.status, "running"))
    .limit(1);
  if (!run) return null;

  // Outstanding (pending/running) jobs across this autorun's batches.
  const [out] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enhanceJobs)
    .innerJoin(enhanceBatches, eq(enhanceJobs.batchId, enhanceBatches.id))
    .where(
      and(
        eq(enhanceBatches.op, "price_wiggle"),
        sql`${enhanceBatches.config}->>'autorunId' = ${run.id}`,
        sql`${enhanceJobs.status} IN ('pending', 'running')`
      )
    );
  const outstanding = out?.n ?? 0;

  const base: AutorunTickResult = { autorunId: run.id, refilled: 0, outstanding };
  if (outstanding >= REFILL_THRESHOLD) return base;

  // Eligible = not yet selected this cycle AND outside the pacing window.
  // Auctions and price-less rows are excluded up front so they don't burn
  // slice slots (the op handler double-checks against the live item anyway).
  const pacingCutoff = new Date(Date.now() - run.minDaysBetween * 86_400_000);
  const notSelectedThisCycle = or(
    isNull(ebayListings.lastAutorunAt),
    lt(ebayListings.lastAutorunAt, run.cycleStartedAt)
  );
  const outsidePacingWindow = or(
    isNull(ebayListings.lastAutorunAt),
    lt(ebayListings.lastAutorunAt, pacingCutoff)
  );
  const wigglable = and(
    sql`${ebayListings.listingType} IS DISTINCT FROM 'Chinese'`,
    sql`${ebayListings.price} IS NOT NULL`
  );

  const slice = await db
    .select({
      ebayItemId: ebayListings.itemId,
      sku: ebayListings.sku,
      title: ebayListings.title,
    })
    .from(ebayListings)
    .where(and(notSelectedThisCycle, outsidePacingWindow, wigglable))
    .orderBy(sql`random()`)
    .limit(SLICE_SIZE);

  if (slice.length > 0) {
    await db
      .update(ebayListings)
      .set({ lastAutorunAt: new Date() })
      .where(
        inArray(
          ebayListings.itemId,
          slice.map((s) => s.ebayItemId)
        )
      );
    await createBatch({
      op: "price_wiggle",
      label: `Autorun cycle ${run.cycleCount + 1}`,
      config: {
        autorunId: run.id,
        amount: Number(run.amount),
        floor: Number(run.floor),
      },
      lowPriority: true,
      items: slice,
    });
    return { ...base, refilled: slice.length };
  }

  // Nothing eligible. If jobs are still in flight, let them drain.
  if (outstanding > 0) return base;

  // Are items merely throttled by the pacing window, or is the cycle done?
  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ebayListings)
    .where(and(notSelectedThisCycle, wigglable));
  if ((waiting?.n ?? 0) > 0) {
    return { ...base, throttled: waiting?.n ?? 0 };
  }

  // Cycle complete.
  const completedCycles = run.cycleCount + 1;
  if (run.maxCycles !== null && completedCycles >= run.maxCycles) {
    await db
      .update(enhanceAutoruns)
      .set({
        cycleCount: completedCycles,
        status: "completed",
        stoppedAt: new Date(),
      })
      .where(eq(enhanceAutoruns.id, run.id));
    return { ...base, cycleCompleted: completedCycles, finished: true };
  }
  await db
    .update(enhanceAutoruns)
    .set({ cycleCount: completedCycles, cycleStartedAt: new Date() })
    .where(eq(enhanceAutoruns.id, run.id));
  return { ...base, cycleCompleted: completedCycles };
}

export type AutorunStatus = {
  run: AutorunRow;
  /** Active listings selected so far in the current cycle. */
  doneThisCycle: number;
  /** Total wigglable listings in the mirror. */
  totalItems: number;
  outstanding: number;
};

/** Status for the Enhance page card (null when nothing is running). */
export async function getActiveAutorunStatus(): Promise<AutorunStatus | null> {
  const [run] = await db
    .select()
    .from(enhanceAutoruns)
    .where(eq(enhanceAutoruns.status, "running"))
    .limit(1);
  if (!run) return null;

  const wigglable = and(
    sql`${ebayListings.listingType} IS DISTINCT FROM 'Chinese'`,
    sql`${ebayListings.price} IS NOT NULL`
  );
  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ebayListings)
    .where(wigglable);
  const [done] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ebayListings)
    .where(
      and(
        wigglable,
        sql`${ebayListings.lastAutorunAt} >= ${run.cycleStartedAt}`
      )
    );
  const [out] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enhanceJobs)
    .innerJoin(enhanceBatches, eq(enhanceJobs.batchId, enhanceBatches.id))
    .where(
      and(
        eq(enhanceBatches.op, "price_wiggle"),
        sql`${enhanceBatches.config}->>'autorunId' = ${run.id}`,
        sql`${enhanceJobs.status} IN ('pending', 'running')`
      )
    );

  return {
    run,
    doneThisCycle: done?.n ?? 0,
    totalItems: total?.n ?? 0,
    outstanding: out?.n ?? 0,
  };
}
