// GET /api/newsletter/unsubscribe?token=...
//
// One-click unsubscribe — required by CAN-SPAM and Gmail's
// bulk-sender rules. We mark the row unsubscribed and never email
// again unless they re-subscribe explicitly.

import { NextRequest, NextResponse } from "next/server";
import { db, newsletterSubscribers } from "@/db";
import { eq } from "drizzle-orm";
import { hashToken } from "@/lib/newsletter";

export const runtime = "nodejs";

const SITE_URL = "https://www.foundinalabama.com";

function redirect(path: string) {
  return NextResponse.redirect(new URL(path, SITE_URL));
}

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return redirect("/newsletter/error?reason=missing");

  const hash = hashToken(token);
  const [row] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.unsubscribeTokenHash, hash))
    .limit(1);

  if (!row) return redirect("/newsletter/error?reason=unknown");

  if (row.status !== "unsubscribed") {
    await db
      .update(newsletterSubscribers)
      .set({
        status: "unsubscribed",
        unsubscribedAt: new Date(),
        // Invalidate the confirm token if any so they can't accidentally
        // re-confirm from an old email.
        confirmTokenHash: null,
        confirmTokenExpiresAt: null,
      })
      .where(eq(newsletterSubscribers.id, row.id));
  }
  return redirect("/newsletter/goodbye");
}
