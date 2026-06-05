// GET /api/admin/ebay/auto-categorize/status
// Returns: { run: {...}, categorizations: [...], queueRemaining }
//
// Used by the client during a run to refresh the results table after
// each /advance call.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getLatestRun,
  getRunCategorizations,
} from "@/lib/ebay/auto-categorize";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const run = await getLatestRun();
    if (!run) {
      return NextResponse.json({ run: null, categorizations: [] });
    }
    const categorizations = await getRunCategorizations(run.id, 500);
    // Don't ship the full queue to the client — it can be huge.
    const { queue: _omit, ...runMeta } = run;
    return NextResponse.json({
      run: runMeta,
      categorizations,
      queueRemaining: Math.max(0, (run.initialQueueCount ?? 0) - run.queueIndex),
    });
  } catch (err) {
    console.error("[/api/admin/ebay/auto-categorize/status] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
