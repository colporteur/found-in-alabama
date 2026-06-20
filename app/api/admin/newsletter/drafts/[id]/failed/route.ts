// GET /api/admin/newsletter/drafts/[id]/failed
// Returns up to 100 most-recent failed send-log rows for this draft so
// the editor can show what specifically went wrong.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, newsletterSendLog } from "@/db";
import { and, eq, desc } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select({
      email: newsletterSendLog.email,
      error: newsletterSendLog.error,
      attemptedAt: newsletterSendLog.attemptedAt,
    })
    .from(newsletterSendLog)
    .where(
      and(
        eq(newsletterSendLog.draftId, params.id),
        eq(newsletterSendLog.status, "failed")
      )
    )
    .orderBy(desc(newsletterSendLog.attemptedAt))
    .limit(100);
  return NextResponse.json({ failed: rows });
}
