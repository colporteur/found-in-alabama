// POST /api/admin/newsletter/drafts/[id]/send
//
// Budgeted, resumable send. Each call drains up to BATCH_SIZE subscribers
// or ~40s of wall time, whichever comes first, and returns progress. The
// client (DraftEditor's Send button) polls until done.
//
// Idempotency: every attempt writes a row to newsletter_send_log keyed
// on (draftId, subscriberId). Re-running an in-progress send skips
// subscribers we've already touched.
//
// Per-recipient unsubscribe tokens: we rotate the subscriber's
// unsubscribe token on each send so the link in the just-delivered
// email always works. Previous newsletters' unsubscribe links stop
// working — that's fine because people unsubscribe from the email they
// just received, not from old ones.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  db,
  newsletterDrafts,
  newsletterSubscribers,
  newsletterSendLog,
} from "@/db";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import {
  generateToken,
  sendEmail,
} from "@/lib/newsletter";
import { renderNewsletterEmail } from "@/lib/newsletter/render";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 50;
const BUDGET_MS = 40_000;

type SendProgress = {
  done: boolean;
  total: number;
  succeeded: number;
  failed: number;
  remaining: number;
  thisCallSucceeded: number;
  thisCallFailed: number;
  lastError?: string;
};

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const draftId = params.id;
  const [draft] = await db
    .select()
    .from(newsletterDrafts)
    .where(eq(newsletterDrafts.id, draftId))
    .limit(1);
  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  // Count total confirmed subscribers (denominator for progress)
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.status, "confirmed"));

  // Counts so far (idempotency window)
  const [{ already }] = await db
    .select({ already: sql<number>`count(*)::int` })
    .from(newsletterSendLog)
    .where(eq(newsletterSendLog.draftId, draftId));
  const [{ succ }] = await db
    .select({ succ: sql<number>`count(*)::int` })
    .from(newsletterSendLog)
    .where(and(
      eq(newsletterSendLog.draftId, draftId),
      eq(newsletterSendLog.status, "sent")
    ));
  const [{ fail }] = await db
    .select({ fail: sql<number>`count(*)::int` })
    .from(newsletterSendLog)
    .where(and(
      eq(newsletterSendLog.draftId, draftId),
      eq(newsletterSendLog.status, "failed")
    ));

  // Pull the next batch: confirmed subscribers NOT yet logged for this draft
  const alreadyLogged = db
    .select({ id: newsletterSendLog.subscriberId })
    .from(newsletterSendLog)
    .where(eq(newsletterSendLog.draftId, draftId));

  const candidates = await db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
    })
    .from(newsletterSubscribers)
    .where(
      and(
        eq(newsletterSubscribers.status, "confirmed"),
        // Drizzle: NOT IN (subquery)
        sql`${newsletterSubscribers.id} NOT IN ${alreadyLogged}`
      )
    )
    .limit(BATCH_SIZE);

  const deadline = Date.now() + BUDGET_MS;
  let thisCallSucceeded = 0;
  let thisCallFailed = 0;
  let lastError: string | undefined;

  for (const sub of candidates) {
    if (Date.now() > deadline) break;

    // Rotate unsubscribe token: new raw token per send, store hash.
    const unsub = generateToken();
    await db
      .update(newsletterSubscribers)
      .set({ unsubscribeTokenHash: unsub.hash })
      .where(eq(newsletterSubscribers.id, sub.id));

    // Build preheader: first ~120 chars of the email body
    const preheader = draft.emailBody
      .replace(/[#>*_`-]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    const rendered = renderNewsletterEmail({
      markdownBody: draft.emailBody,
      preheader,
      unsubscribeRawToken: unsub.raw,
    });

    const result = await sendEmail({
      to: sub.email,
      subject: draft.emailSubject,
      html: rendered.html,
      text: rendered.text,
    });

    if (result.ok) {
      await db.insert(newsletterSendLog).values({
        draftId,
        subscriberId: sub.id,
        email: sub.email,
        status: "sent",
        resendId: result.id || null,
      });
      thisCallSucceeded++;
    } else {
      await db.insert(newsletterSendLog).values({
        draftId,
        subscriberId: sub.id,
        email: sub.email,
        status: "failed",
        error: result.error.slice(0, 500),
      });
      thisCallFailed++;
      lastError = result.error;
    }
  }

  const totalProcessed = Number(already) + thisCallSucceeded + thisCallFailed;
  const finalSucceeded = Number(succ) + thisCallSucceeded;
  const finalFailed = Number(fail) + thisCallFailed;
  const remaining = Math.max(0, Number(total) - totalProcessed);
  const done = remaining === 0;

  // If complete, flip the draft to sent
  if (done && draft.status !== "sent") {
    await db
      .update(newsletterDrafts)
      .set({
        status: "sent",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(newsletterDrafts.id, draftId));
  }

  const progress: SendProgress = {
    done,
    total: Number(total),
    succeeded: finalSucceeded,
    failed: finalFailed,
    remaining,
    thisCallSucceeded,
    thisCallFailed,
    lastError,
  };
  return NextResponse.json(progress);
}
