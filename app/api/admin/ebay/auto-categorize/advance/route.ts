// POST /api/admin/ebay/auto-categorize/advance
// Body: { runId: string }
// Returns: { done: boolean, processedItemId?: string, outcome?: string }
//
// Processes exactly one item from the run's queue. Client paces calls
// (typically ~2 seconds apart). Returns done=true when queue is empty.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { processNext } from "@/lib/ebay/auto-categorize";

export const runtime = "nodejs";
export const maxDuration = 30; // one Claude call (~3s) + one ReviseItem (~3s); 30 is plenty

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { runId?: string };
  try {
    body = (await req.json()) as { runId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  try {
    const result = await processNext(body.runId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/admin/ebay/auto-categorize/advance] failed", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
