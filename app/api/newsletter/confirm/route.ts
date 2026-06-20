// GET /api/newsletter/confirm?token=...
//
// Hash the URL token, look up the matching pending subscriber, mark
// confirmed. Redirects to a friendly landing page; never echoes the
// token back.

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
    .where(eq(newsletterSubscribers.confirmTokenHash, hash))
    .limit(1);

  if (!row) return redirect("/newsletter/error?reason=unknown");

  if (row.status === "confirmed") {
    // Already confirmed (maybe clicked twice) — friendly success page.
    return redirect("/newsletter/welcome");
  }

  if (
    row.confirmTokenExpiresAt &&
    row.confirmTokenExpiresAt.getTime() < Date.now()
  ) {
    return redirect("/newsletter/error?reason=expired");
  }

  await db
    .update(newsletterSubscribers)
    .set({
      status: "confirmed",
      confirmedAt: new Date(),
      confirmTokenHash: null,
      confirmTokenExpiresAt: null,
    })
    .where(eq(newsletterSubscribers.id, row.id));

  return redirect("/newsletter/welcome");
}
