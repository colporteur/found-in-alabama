// Phase B — automatic draft generation.
//
// Called from the cron (app/api/cron/publish). Finds new hauls and
// freshly captured items that have no social drafts yet, generates
// channel content for them via generateChannelDrafts(), and saves the
// drafts with status "draft" — the cron's scheduling step then assigns
// slots on the next pass.
//
// Volume control (matches docs/social-posting-plan.md):
//  - Hauls get all six channels (they're the "non-listing" content mix).
//  - Items get Pinterest (evergreen) + an Instagram story + TWO rotated
//    channels from [instagram_feed, facebook, twitter, bluesky] so each
//    item shows up on a different subset and weekly caps aren't blown.
//  - At most ONE generation per cron run and ITEM_GENERATIONS_PER_DAY
//    item generations per Central-time day. Items beyond that capacity
//    simply wait; Phase C's recycling engine will pick up stragglers.

import { and, eq, gte, isNotNull, notInArray, asc, sql } from "drizzle-orm";
import { db, items, socialDrafts } from "@/db";
import { getAllPosts } from "@/lib/posts";
import { generateChannelDrafts } from "@/lib/social/generate";
import { centralDayKey } from "@/lib/social/schedule";
import type { ChannelKey } from "@/lib/social/channel-styles";

/** Marker stored in the notes column so auto-created drafts are identifiable. */
export const AUTO_NOTE = "auto-generated";

const ITEM_GENERATIONS_PER_DAY = 1;
/** Only consider items captured in the last N days; older inventory is Phase C's job. */
const ITEM_FRESHNESS_DAYS = 14;
/** Only consider hauls published in the last N days. */
const HAUL_FRESHNESS_DAYS = 14;

const ROTATING_CHANNELS: ChannelKey[] = [
  "instagram_feed",
  "facebook",
  "twitter",
  "bluesky",
];

/** Deterministic small hash so an item always rotates to the same channels. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Channels a given item should be promoted on. */
export function channelsForItem(itemId: string): ChannelKey[] {
  const start = hashString(itemId) % ROTATING_CHANNELS.length;
  const rotated = [
    ROTATING_CHANNELS[start],
    ROTATING_CHANNELS[(start + 1) % ROTATING_CHANNELS.length],
  ];
  return ["pinterest", "instagram_story", ...rotated];
}

const ALL_CHANNELS: ChannelKey[] = [
  "instagram_feed",
  "instagram_story",
  "facebook",
  "twitter",
  "pinterest",
  "bluesky",
];

type AutoGenResult = {
  generated: boolean;
  kind?: "haul" | "item";
  sourceId?: string;
  draftsSaved?: number;
  skippedReason?: string;
  error?: string;
};

/** How many auto item-generations have happened today (Central time)? */
async function itemGenerationsToday(now: Date): Promise<number> {
  const since = new Date(now.getTime() - 36 * 3600_000); // generous window, filter precisely below
  const rows = await db
    .select({
      generationId: socialDrafts.generationId,
      createdAt: socialDrafts.createdAt,
    })
    .from(socialDrafts)
    .where(
      and(
        eq(socialDrafts.sourceType, "item"),
        eq(socialDrafts.notes, AUTO_NOTE),
        gte(socialDrafts.createdAt, since)
      )
    );
  const today = centralDayKey(now);
  const gens = new Set(
    rows
      .filter((r) => centralDayKey(r.createdAt) === today)
      .map((r) => r.generationId)
  );
  return gens.size;
}

/** Newest published haul that has no drafts yet (within freshness window). */
async function findHaulNeedingDrafts(): Promise<string | null> {
  const cutoff = Date.now() - HAUL_FRESHNESS_DAYS * 86_400_000;
  const posts = getAllPosts().filter((p) => {
    const t = new Date(p.date).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  if (posts.length === 0) return null;

  const slugs = posts.map((p) => p.slug);
  const covered = await db
    .selectDistinct({ sourceId: socialDrafts.sourceId })
    .from(socialDrafts)
    .where(eq(socialDrafts.sourceType, "haul"));
  const coveredSet = new Set(covered.map((c) => c.sourceId));
  const uncovered = posts
    .filter((p) => !coveredSet.has(p.slug))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return uncovered[0]?.slug ?? null;
}

/** Oldest fresh active item (with slug + photo) that has no drafts yet. */
async function findItemNeedingDrafts(): Promise<string | null> {
  const cutoff = new Date(Date.now() - ITEM_FRESHNESS_DAYS * 86_400_000);
  const covered = await db
    .selectDistinct({ sourceId: socialDrafts.sourceId })
    .from(socialDrafts)
    .where(eq(socialDrafts.sourceType, "item"));
  const coveredIds = covered.map((c) => c.sourceId);

  const candidates = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.status, "active"),
        isNotNull(items.slug),
        isNotNull(items.heroImage),
        gte(items.capturedAt, cutoff),
        coveredIds.length > 0
          ? notInArray(sql`${items.id}::text`, coveredIds)
          : undefined
      )
    )
    .orderBy(asc(items.capturedAt))
    .limit(1);
  return candidates[0]?.id ?? null;
}

/**
 * Run at most one auto-generation. Hauls take priority (they're rarer
 * and time-sensitive); then items, subject to the daily cap.
 */
export async function runAutoGeneration(
  now: Date = new Date()
): Promise<AutoGenResult> {
  // 1. Haul without drafts?
  let kind: "haul" | "item";
  let sourceId: string | null = await findHaulNeedingDrafts();
  let channels: ChannelKey[];
  let contentType: "new-haul" | "just-listed";

  if (sourceId) {
    kind = "haul";
    channels = ALL_CHANNELS;
    contentType = "new-haul";
  } else {
    // 2. Item, if today's budget allows.
    const used = await itemGenerationsToday(now);
    if (used >= ITEM_GENERATIONS_PER_DAY) {
      return {
        generated: false,
        skippedReason: `Daily item generation cap reached (${used}/${ITEM_GENERATIONS_PER_DAY})`,
      };
    }
    sourceId = await findItemNeedingDrafts();
    if (!sourceId) {
      return { generated: false, skippedReason: "Nothing needs drafts" };
    }
    kind = "item";
    channels = channelsForItem(sourceId);
    contentType = "just-listed";
  }

  try {
    const result = await generateChannelDrafts({
      sourceType: kind,
      sourceId,
      channels,
      contentType,
    });

    const entries = Object.entries(result.drafts);
    if (entries.length === 0) {
      return {
        generated: false,
        kind,
        sourceId,
        error: "Generation returned no channel content",
      };
    }

    const rows = await db
      .insert(socialDrafts)
      .values(
        entries.map(([channel, content]) => ({
          sourceType: result.source.sourceType,
          sourceId: result.source.sourceId,
          sourceTitle: result.source.sourceTitle,
          sourceImage: result.source.sourceImage,
          sourceUrl: result.source.sourceUrl,
          generationId: result.generationId,
          contentType,
          channel,
          content: content as Record<string, unknown>,
          notes: AUTO_NOTE,
        }))
      )
      .returning({ id: socialDrafts.id });

    console.log(
      `[auto-generate] ${kind} ${sourceId}: saved ${rows.length} drafts (${entries
        .map(([c]) => c)
        .join(", ")})`
    );
    return { generated: true, kind, sourceId, draftsSaved: rows.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[auto-generate] ${kind} ${sourceId} failed: ${msg}`);
    return { generated: false, kind, sourceId, error: msg };
  }
}
