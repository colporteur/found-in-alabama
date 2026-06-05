// POST /api/admin/ebay/auto-categorize/cancel
// Body: { runId: string }
// Marks a running run as cancelled. The client should stop polling
// /advance after this returns.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { ebayAutoCategorizeRuns } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

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

  await db
    .update(ebayAutoCategorizeRuns)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(ebayAutoCategorizeRuns.id, body.runId));

  return NextResponse.json({ ok: true });
}
