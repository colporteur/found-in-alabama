// POST /api/admin/enhance/rollback-session — roll back everything the
// pipeline completed in the trailing window (default 24h), one budgeted
// slice per call; the client loops until `remaining` reaches 0.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { rollbackSlice } from "@/lib/enhance/rollback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SLICE_BUDGET_MS = 35_000;
const MAX_HOURS = 24 * 7;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let hours = 24;
  try {
    const body = await req.json();
    const h = Number(body?.hours);
    if (Number.isFinite(h) && h > 0) hours = Math.min(h, MAX_HOURS);
  } catch {
    // no body → default 24h
  }

  const summary = await rollbackSlice({ sinceHours: hours }, SLICE_BUDGET_MS);
  return NextResponse.json(summary);
}
