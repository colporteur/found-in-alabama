// POST /api/admin/enhance/autorun — start the Autorun price bump.
// Body: { amount: number, floor?: number, minDaysBetween?: number,
//         maxCycles?: number | null }
// One autorun at a time. On success, immediately runs one autorun tick so
// the first slice batch is queued before the response returns (the 5-min
// cron and the "Run queue now" button pick it up from there).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { autorunTick, startAutorun } from "@/lib/enhance/autorun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await startAutorun({
    amount: Number(body.amount),
    floor: body.floor !== undefined && body.floor !== null && body.floor !== ""
      ? Number(body.floor)
      : undefined,
    minDaysBetween:
      body.minDaysBetween !== undefined &&
      body.minDaysBetween !== null &&
      body.minDaysBetween !== ""
        ? Number(body.minDaysBetween)
        : undefined,
    maxCycles:
      body.maxCycles !== undefined && body.maxCycles !== null && body.maxCycles !== ""
        ? Number(body.maxCycles)
        : null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Queue the first slice right away so Start feels instant.
  try {
    await autorunTick();
  } catch (err) {
    console.error(
      "[autorun] first tick after start failed:",
      err instanceof Error ? err.message : err
    );
  }

  return NextResponse.json({ ok: true, autorun: result.autorun });
}
