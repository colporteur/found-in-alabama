// GET /api/cron/publish — the social automation heartbeat (Phase A).
//
// Runs every 15 minutes via Vercel cron (see vercel.json). Two steps:
//
//   1. AUTO-SCHEDULE: any draft with status "draft" gets assigned the next
//      open slot for its channel per lib/social/schedule.ts and flips to
//      "scheduled". (Full-auto mode — mark a draft "skipped" in the queue
//      to keep it from going out.) Drafts from the same generation are
//      staggered across days per the plan's rotation rules.
//
//   2. PUBLISH: scheduled drafts whose scheduledFor has arrived are posted
//      through the normal adapters (BlueSky / Pinterest / Publer). Outcomes
//      are written back exactly like the manual "Post now" button.
//
// Auth: Vercel sends "Authorization: Bearer ${CRON_SECRET}" when the
// CRON_SECRET env var is set. A logged-in admin session also works so the
// endpoint can be triggered manually for testing.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, socialDrafts } from "@/db";
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { postDraft } from "@/lib/posting";
import { nextSlotFor, staggerFor } from "@/lib/social/schedule";
import { runAutoGeneration } from "@/lib/social/auto-generate";
import type { ChannelKey } from "@/lib/social/channel-styles";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Publishing can take up to ~40s per Publer draft (job polling), so keep
// the per-run batch small; the cron's 15-minute cadence provides volume.
const PUBLISH_BATCH = 2;
const SCHEDULE_BATCH = 24;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return true;
  const session = await auth();
  return !!session?.user;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const summary = {
    generated: 0,
    scheduled: 0,
    published: 0,
    failed: 0,
    errors: [] as string[],
  };

  // ── Step 1: auto-schedule plain drafts ────────────────────────────────────
  try {
    // Only never-attempted drafts auto-schedule. A draft with attempts
    // already on it is either failed (visible in the queue) or was
    // claimed by a run that died mid-post — both need human eyes, not a
    // silent retry that could double-post.
    const drafts = await db
      .select()
      .from(socialDrafts)
      .where(
        and(eq(socialDrafts.status, "draft"), eq(socialDrafts.attemptCount, 0))
      )
      .orderBy(asc(socialDrafts.createdAt))
      .limit(SCHEDULE_BATCH);

    if (drafts.length > 0) {
      // Existing future commitments per channel (for caps/clearance).
      const channels = [...new Set(drafts.map((d) => d.channel))];
      const upcoming = await db
        .select({
          channel: socialDrafts.channel,
          scheduledFor: socialDrafts.scheduledFor,
        })
        .from(socialDrafts)
        .where(
          and(
            eq(socialDrafts.status, "scheduled"),
            inArray(socialDrafts.channel, channels),
            gt(socialDrafts.scheduledFor, new Date(now.getTime() - 86_400_000))
          )
        );
      const takenByChannel = new Map<string, Date[]>();
      for (const u of upcoming) {
        if (!u.scheduledFor) continue;
        const arr = takenByChannel.get(u.channel) ?? [];
        arr.push(u.scheduledFor);
        takenByChannel.set(u.channel, arr);
      }

      for (const draft of drafts) {
        const channel = draft.channel as ChannelKey;
        // Stagger multi-channel rollouts of the same item.
        const notBefore = new Date(
          now.getTime() + staggerFor(channel) * 86_400_000
        );
        const taken = takenByChannel.get(draft.channel) ?? [];
        const slot = nextSlotFor(channel, taken, notBefore);
        if (!slot) {
          summary.errors.push(
            `No open slot for ${draft.channel} draft ${draft.id}`
          );
          continue;
        }
        await db
          .update(socialDrafts)
          .set({ status: "scheduled", scheduledFor: slot, updatedAt: new Date() })
          .where(
            and(eq(socialDrafts.id, draft.id), eq(socialDrafts.status, "draft"))
          );
        taken.push(slot);
        takenByChannel.set(draft.channel, taken);
        summary.scheduled++;
        console.log(
          `[cron] scheduled ${draft.channel} draft ${draft.id} for ${slot.toISOString()}`
        );
      }
    }
  } catch (err) {
    summary.errors.push(
      `Auto-schedule step failed: ${err instanceof Error ? err.message : "unknown"}`
    );
  }

  // ── Step 2: publish due drafts ────────────────────────────────────────────
  try {
    const due = await db
      .select()
      .from(socialDrafts)
      .where(
        and(
          eq(socialDrafts.status, "scheduled"),
          lte(socialDrafts.scheduledFor, now)
        )
      )
      .orderBy(asc(socialDrafts.scheduledFor))
      .limit(PUBLISH_BATCH);

    for (const draft of due) {
      // Claim the row first so an overlapping run can't double-post:
      // only proceed if we're the one who flipped it out of "scheduled".
      const claimed = await db
        .update(socialDrafts)
        .set({
          status: "draft", // transient while posting; restored below
          attemptCount: (draft.attemptCount ?? 0) + 1,
          lastAttemptAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(socialDrafts.id, draft.id),
            eq(socialDrafts.status, "scheduled")
          )
        )
        .returning({ id: socialDrafts.id });
      if (claimed.length === 0) continue; // another run got it

      console.log(`[cron] publishing ${draft.channel} draft ${draft.id}`);
      const result = await postDraft({
        channel: draft.channel as ChannelKey,
        content: draft.content as Record<string, unknown>,
        sourceImage: draft.sourceImage,
        sourceTitle: draft.sourceTitle,
        sourceUrl: draft.sourceUrl ?? null,
      });

      if (result.ok) {
        await db
          .update(socialDrafts)
          .set({
            status: "posted",
            postedAt: new Date(),
            postId: result.postId,
            postUrl: result.postUrl,
            postError: null,
            updatedAt: new Date(),
          })
          .where(eq(socialDrafts.id, draft.id));
        summary.published++;
      } else {
        await db
          .update(socialDrafts)
          .set({
            status: "failed",
            postError: result.error,
            updatedAt: new Date(),
          })
          .where(eq(socialDrafts.id, draft.id));
        summary.failed++;
        summary.errors.push(
          `${draft.channel} draft ${draft.id}: ${result.error}`
        );
      }
    }
  } catch (err) {
    summary.errors.push(
      `Publish step failed: ${err instanceof Error ? err.message : "unknown"}`
    );
  }

  // ── Step 3: auto-generate drafts (Phase B) ───────────────────────────────
  // Only when this run did no publishing — generation takes a Claude
  // vision call (~15-25s) and we stay inside the 60s function budget.
  // With 96 runs/day there are plenty of idle runs to generate in.
  if (summary.published === 0 && summary.failed === 0) {
    try {
      const gen = await runAutoGeneration(now);
      if (gen.generated) {
        summary.generated = gen.draftsSaved ?? 0;
      } else if (gen.error) {
        summary.errors.push(`Auto-generate: ${gen.error}`);
      }
      // skippedReason (cap reached / nothing to do) is normal — not logged
      // as an error.
    } catch (err) {
      summary.errors.push(
        `Auto-generate step failed: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  console.log(`[cron] run summary:`, JSON.stringify(summary));
  return NextResponse.json(summary);
}
