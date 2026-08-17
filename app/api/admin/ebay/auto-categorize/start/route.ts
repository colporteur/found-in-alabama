// POST /api/admin/ebay/auto-categorize/start
// Body: { phase: "primary" | "secondary" }
// Returns: { runId, initialQueueCount }

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  collectEligibleItems,
  getLatestRun,
  getOtherCategoryId,
  resumeRun,
  startRun,
  type RunPhase,
} from "@/lib/ebay/auto-categorize";

export const runtime = "nodejs";
export const maxDuration = 60; // collecting eligible items can take ~30s for a 5k store

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { phase?: RunPhase };
  try {
    body = (await req.json()) as { phase?: RunPhase };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const phase = body.phase ?? "primary";
  if (phase !== "primary" && phase !== "secondary") {
    return NextResponse.json(
      { error: "phase must be 'primary' or 'secondary'" },
      { status: 400 }
    );
  }

  const otherId = await getOtherCategoryId();
  if (!otherId) {
    return NextResponse.json(
      {
        error:
          "Other category not found. Run a category sync first via /admin/ebay/categories.",
      },
      { status: 400 }
    );
  }

  try {
    // A run paused on eBay's call ceiling still holds its queue and its
    // position, so Start resumes it rather than wiping it — startRun()
    // deletes all prior runs, which would throw away the work already
    // surveyed and re-decide items unnecessarily.
    //
    // Resume regardless of the requested phase: the UI disables the
    // secondary radio until a primary run has COMPLETED, so a paused
    // secondary run would otherwise be unreachable — the only button
    // Todd could press is Start-primary, which would destroy it.
    const latest = await getLatestRun();
    if (latest?.status === "paused") {
      const resumed = await resumeRun(latest.id);
      if (resumed) {
        return NextResponse.json({
          runId: resumed.id,
          initialQueueCount: resumed.initialQueueCount,
          resumed: true,
        });
      }
    }

    const queue = await collectEligibleItems(phase, otherId);
    const run = await startRun(phase, queue);
    return NextResponse.json({
      runId: run.id,
      initialQueueCount: run.initialQueueCount,
    });
  } catch (err) {
    console.error("[/api/admin/ebay/auto-categorize/start] failed", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
