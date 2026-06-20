// POST /api/admin/newsletter/drafts/[id]/retry-failed
//
// Wipes failed send-log rows for this draft so the existing /send
// endpoint picks those subscribers back up on the next pass. No status
// change to the draft itself — sent drafts stay locked, retry just
// queues up the previously-failed recipients.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, newsletterSendLog } from "@/db";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const deleted = await db
    .delete(newsletterSendLog)
    .where(
      and(
        eq(newsletterSendLog.draftId, params.id),
        eq(newsletterSendLog.status, "failed")
      )
    )
    .returning({ id: newsletterSendLog.subscriberId });
  return NextResponse.json({ ok: true, requeued: deleted.length });
}
