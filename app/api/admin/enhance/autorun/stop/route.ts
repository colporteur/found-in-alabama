// POST /api/admin/enhance/autorun/stop — stop the active Autorun and
// cancel its queued slice batches. In-flight jobs finish their current
// item; anchors and history stay intact, so per-job rollback still works.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { stopAutorun } from "@/lib/enhance/autorun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await stopAutorun();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, batchesCancelled: result.batchesCancelled });
}
