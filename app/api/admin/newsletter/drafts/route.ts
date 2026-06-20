// GET /api/admin/newsletter/drafts — list saved drafts (newest first).

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, newsletterDrafts } from "@/db";
import { desc } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select({
      id: newsletterDrafts.id,
      label: newsletterDrafts.label,
      status: newsletterDrafts.status,
      emailSubject: newsletterDrafts.emailSubject,
      ebaySubject: newsletterDrafts.ebaySubject,
      emailRecipientCount: newsletterDrafts.emailRecipientCount,
      generatedAt: newsletterDrafts.generatedAt,
      sentAt: newsletterDrafts.sentAt,
      updatedAt: newsletterDrafts.updatedAt,
    })
    .from(newsletterDrafts)
    .orderBy(desc(newsletterDrafts.generatedAt))
    .limit(50);
  return NextResponse.json({ drafts: rows });
}
