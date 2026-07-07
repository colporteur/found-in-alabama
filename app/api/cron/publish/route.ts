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
import { and, asc, eq, gt, inArray, lte, notInArray } from "drizzle-orm";
import { postDraft } from "@/lib/posting";
import {
  disabledChannels,
  nextSlotFor,
  staggerFor,
} from "@/lib/social/schedule";
import { runAutoGeneration } from "@/lib/social/auto-generate";
import type { ChannelKey } from "@/lib/social/channel-styles";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// GitHub's */15 schedule fires unreliably (observed ~every 2 hours), so
// each tick clears as much as it safely can inside Vercel's 60s cap.
// CRUCIAL: budget by the WORST CASE of the next post, not elapsed time —
// a Publer post (media upload + job polling) can take ~40s, so starting
// one at 35s elapsed means a 504 and a killed function. Before each
// post we peek the draft's channel and only proceed if its worst case
// still fits under the hard cap. Same rule gates auto-generation
// (~15-25s Claude vision call).
const HARD_CAP_MS = 55_000; // leave headroom under maxDuration=60
const HEAVY_POST_MS = 42_000; // Publer channels (IG/FB/X)
const LIGHT_POST_MS = 10_000; // direct APIs (BlueSky, Pinterest)
const GENERATION_MS = 26_000;
const HEAVY_CHANNELS = new Set([
  "instagram_feed",
  "instagram_story",
  "facebook",
  "twitter",
]);
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

  const tickStart = Date.now();
  const now = new Date();
  const disabled = disabledChannels();
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
        // Paused channels: leave their drafts unscheduled (they resume
        // automatically when SOCIAL_DISABLED_CHANNELS is cleared).
        if (disabled.has(channel)) continue;
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

  // ── Step 2: publish due drafts while their worst case fits the cap ───────
  try {
    const attempted: string[] = [];
    while (true) {
      const [draft] = await db
        .select()
        .from(socialDrafts)
        .where(
          and(
            eq(socialDrafts.status, "scheduled"),
            lte(socialDrafts.scheduledFor, new Date()),
            attempted.length > 0
              ? notInArray(socialDrafts.id, attempted)
              : undefined
          )
        )
        .orderBy(asc(socialDrafts.scheduledFor))
        .limit(1);
      if (!draft) break;

      // Would this post's worst case blow the cap? Stop — next tick gets it.
      const costMs = HEAVY_CHANNELS.has(draft.channel)
        ? HEAVY_POST_MS
        : LIGHT_POST_MS;
      if (Date.now() - tickStart + costMs > HARD_CAP_MS) break;
      attempted.push(draft.id);
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
        contentType: draft.contentType,
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
  // Runs whenever generation's worst case still fits under the cap —
  // with GitHub delivering far fewer ticks than scheduled, generation
  // can't afford to wait for idle runs.
  if (Date.now() - tickStart + GENERATION_MS < HARD_CAP_MS) {
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
