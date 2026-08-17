// GET /api/cron/categorize — automated auto-categorize tick.
//
// The categorizer was browser-driven only (the admin page advances one
// item per ~2s while the tab is open), so the Other bucket refilled
// between manual sessions — especially with Nifty recreates reverting
// ~100 listings/day to no-store-category. This tick makes draining
// automatic: resume (or start) a run and process items until the time
// budget is spent. Primary phase (escape the Other bucket) when it has
// work; secondary (fill missing 2nd categories) otherwise.
//
// Auth: CRON_SECRET bearer or admin session, like the other crons.
// Pinged by the enhance + social GitHub workflows as an extra step.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  collectEligibleItems,
  getLatestRun,
  getOtherCategoryId,
  processNext,
  resumeRun,
  startRun,
} from "@/lib/ebay/auto-categorize";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BUDGET_MS = 40_000;
/** Each item ≈ one Claude call + one ReviseItem (~5-8s). */
const ITEM_WORST_MS = 9_000;
/**
 * How long to leave a quota-paused run alone before retrying. eBay's
 * daily application limit resets once a day, so an hour is a cheap probe:
 * one wasted call per hour at worst, and the run restarts on its own
 * within an hour of the reset without anyone opening a browser.
 */
const QUOTA_COOLDOWN_MS = 60 * 60_000;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return true;
  const session = await auth();
  return !!session?.user;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tickStart = Date.now();
  const summary = {
    resumed: false,
    startedPhase: null as string | null,
    processed: 0,
    done: false,
    error: null as string | null,
  };

  try {
    // Resume an in-flight run, else start a fresh one where there's work.
    let run = await getLatestRun();

    // A run paused on eBay's call ceiling keeps its queue and position.
    // Don't stomp it with a fresh run — wait out the quota, then resume
    // in place. Starting over would re-burn LLM calls on items already
    // decided and just hit the same wall again.
    if (run?.status === "paused") {
      const pausedAt = run.completedAt?.getTime() ?? run.startedAt.getTime();
      if (Date.now() - pausedAt < QUOTA_COOLDOWN_MS) {
        return NextResponse.json({
          ...summary,
          error: `Paused on eBay call limit; retrying after ${Math.round(
            (QUOTA_COOLDOWN_MS - (Date.now() - pausedAt)) / 60_000
          )} more minutes`,
        });
      }
      const resumed = await resumeRun(run.id);
      if (resumed) {
        run = resumed;
        summary.resumed = true;
      } else {
        // Another tick resumed (or replaced) it between our read and our
        // write. Re-read rather than falling through — the start-new-run
        // path below DELETES all runs, which would destroy the very queue
        // and position this pause existed to protect.
        run = await getLatestRun();
        if (run?.status === "paused") {
          // Still paused after a re-read: leave it entirely alone this
          // tick rather than risk the delete path.
          return NextResponse.json({
            ...summary,
            error: "Paused run changed underfoot — leaving it for the next tick",
          });
        }
      }
    }

    if (!run || run.status !== "running") {
      const otherId = await getOtherCategoryId();
      if (!otherId) {
        return NextResponse.json({
          ...summary,
          error: "No Other bucket flagged — run the category sync",
        });
      }
      const primary = await collectEligibleItems("primary", otherId);
      if (primary.length > 0) {
        run = await startRun("primary", primary);
        summary.startedPhase = "primary";
      } else {
        const secondary = await collectEligibleItems("secondary", otherId);
        if (secondary.length === 0) {
          return NextResponse.json({ ...summary, done: true });
        }
        run = await startRun("secondary", secondary);
        summary.startedPhase = "secondary";
      }
    } else {
      summary.resumed = true;
    }

    while (Date.now() - tickStart + ITEM_WORST_MS < BUDGET_MS) {
      const result = await processNext(run.id);
      if (result.processedItemId) summary.processed++;
      if (result.outcome === "quota_exceeded") {
        summary.error = "eBay call limit reached — run paused, position saved";
        break;
      }
      if (result.done) {
        summary.done = true;
        break;
      }
      if (!result.processedItemId) {
        // Item claimed by a concurrent worker (the other cron, or Todd's
        // browser). Yield the tick rather than spinning on contention.
        break;
      }
    }

    if (summary.processed > 0 || summary.startedPhase || summary.error) {
      console.log("[categorize-cron]", JSON.stringify(summary));
    }
    return NextResponse.json(summary);
  } catch (err) {
    summary.error = err instanceof Error ? err.message : "unknown";
    console.error("[categorize-cron] failed:", summary.error);
    return NextResponse.json(summary, { status: 500 });
  }
}
