// GET /api/cron/enhance — the Expert Enhance batch runner tick.
//
// Pinged every 5 minutes by the GitHub Action (.github/workflows/
// enhance-cron.yml — Vercel Hobby crons are daily-only, same workaround
// as the social publish heartbeat). Each tick processes pending
// enhance_jobs one at a time until ~45s of the 60s function budget is
// spent, then exits; the next tick picks up where it left off. Idle
// ticks (no pending jobs) return immediately and cost nothing.
//
// Auth: "Authorization: Bearer ${CRON_SECRET}" or a logged-in admin
// session (so the dashboard's "Run now" button works).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { processTick } from "@/lib/enhance/queue";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const TICK_BUDGET_MS = 45_000;

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

  try {
    const summary = await processTick(TICK_BUDGET_MS);
    if (summary.processed > 0) {
      console.log("[enhance-cron] tick summary:", JSON.stringify(summary));
    }
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[enhance-cron] tick failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
