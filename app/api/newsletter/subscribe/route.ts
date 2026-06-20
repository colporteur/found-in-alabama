// POST /api/newsletter/subscribe
// Body: { email: string, source?: string }
//
// New addresses get a row + a confirmation email. Existing pending or
// unsubscribed rows have their confirm token rotated and a fresh email
// sent. Already-confirmed addresses get a silent 200 so we never reveal
// whether an email is on the list to a bot or curious passerby.

import { NextRequest, NextResponse } from "next/server";
import { db, newsletterSubscribers } from "@/db";
import { eq } from "drizzle-orm";
import {
  CONFIRM_TOKEN_TTL_HOURS,
  generateToken,
  isValidEmail,
  normalizeEmail,
  sendConfirmEmail,
} from "@/lib/newsletter";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_SOURCES = new Set([
  "footer",
  "journal_post",
  "home_banner",
  "newsletter_page",
]);

export async function POST(req: NextRequest) {
  let body: { email?: string; source?: string };
  try {
    body = (await req.json()) as { email?: string; source?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? "");
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }
  const source = body.source && ALLOWED_SOURCES.has(body.source)
    ? body.source
    : null;

  // Look up any existing row by normalized email.
  const [existing] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email))
    .limit(1);

  // Already confirmed: silent success so we don't expose membership.
  if (existing?.status === "confirmed") {
    return NextResponse.json({ ok: true });
  }

  // Generate fresh tokens for this signup attempt.
  const confirmToken = generateToken();
  const unsubToken = generateToken();
  const expiresAt = new Date(
    Date.now() + CONFIRM_TOKEN_TTL_HOURS * 60 * 60 * 1000
  );

  if (existing) {
    // Pending or unsubscribed — rotate token, re-set status to pending.
    await db
      .update(newsletterSubscribers)
      .set({
        status: "pending",
        confirmTokenHash: confirmToken.hash,
        confirmTokenExpiresAt: expiresAt,
        unsubscribeTokenHash: unsubToken.hash,
        unsubscribedAt: null,
        confirmedAt: null,
        source: source ?? existing.source,
      })
      .where(eq(newsletterSubscribers.id, existing.id));
  } else {
    await db.insert(newsletterSubscribers).values({
      email,
      status: "pending",
      confirmTokenHash: confirmToken.hash,
      confirmTokenExpiresAt: expiresAt,
      unsubscribeTokenHash: unsubToken.hash,
      source,
    });
  }

  const send = await sendConfirmEmail(email, confirmToken.raw);
  if (!send.ok) {
    console.error("[/api/newsletter/subscribe] send failed", send.error);
    // Don't 500 — the row is created, user can re-submit. We tell them
    // we tried but couldn't reach their inbox right now.
    return NextResponse.json(
      {
        error:
          "We saved your signup, but our mail provider didn't accept the confirmation email. Try again in a minute.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
