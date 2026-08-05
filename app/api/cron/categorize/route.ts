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
  startRun,
} from "@/lib/ebay/auto-categorize";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BUDGET_MS = 40_000;
/** Each item ≈ one Claude call + one ReviseItem (~5-8s). */
const ITEM_WORST_MS = 9_000;

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
      if (result.done) {
        summary.done = true;
        break;
      }
    }

    if (summary.processed > 0 || summary.startedPhase) {
      console.log("[categorize-cron]", JSON.stringify(summary));
    }
    return NextResponse.json(summary);
  } catch (err) {
    summary.error = err instanceof Error ? err.message : "unknown";
    console.error("[categorize-cron] failed:", summary.error);
    return NextResponse.json(summary, { status: 500 });
  }
}
