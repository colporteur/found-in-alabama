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

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  max,
  notInArray,
  sql,
} from "drizzle-orm";
import { db, items, socialDrafts } from "@/db";
import { getAllPosts } from "@/lib/posts";
import { generateChannelDrafts } from "@/lib/social/generate";
import { centralDayKey, disabledChannels } from "@/lib/social/schedule";
import type { ChannelKey } from "@/lib/social/channel-styles";

/** Marker stored in the notes column so auto-created drafts are identifiable. */
export const AUTO_NOTE = "auto-generated";
/** Marker for Phase C drafts (backfill + recycling) — separate daily budget. */
export const AUTO_RECYCLE_NOTE = "auto-recycled";

const ITEM_GENERATIONS_PER_DAY = 2;
/** Only consider items captured in the last N days; older inventory is Phase C's job. */
const ITEM_FRESHNESS_DAYS = 14;
/** Only consider hauls published in the last N days. */
const HAUL_FRESHNESS_DAYS = 14;

// Phase C — recycling unsold inventory.
/** Max re-promotion generations per Central-time day. */
const RECYCLE_GENERATIONS_PER_DAY = 2;
/** An item must be unsold this long before recycling kicks in. */
const RECYCLE_MIN_AGE_DAYS = 30;
/** ...and this long since its last promotion (research: ~21-day repost rule). */
const RECYCLE_COOLDOWN_DAYS = 21;

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

/**
 * Channels a given item should be promoted on. `round` shifts the
 * rotation so re-promotions (Phase C) hit different channels than the
 * original posts did.
 */
export function channelsForItem(itemId: string, round = 0): ChannelKey[] {
  const start =
    (hashString(itemId) + round * 2) % ROTATING_CHANNELS.length;
  const rotated = [
    ROTATING_CHANNELS[start],
    ROTATING_CHANNELS[(start + 1) % ROTATING_CHANNELS.length],
  ];
  return ["pinterest", "instagram_story", ...rotated];
}

/** Recycling posts go to the cheap channels + ONE rotated text channel. */
export function channelsForRecycle(
  itemId: string,
  round: number
): ChannelKey[] {
  const start =
    (hashString(itemId) + 2 + round) % ROTATING_CHANNELS.length;
  return ["pinterest", "instagram_story", ROTATING_CHANNELS[start]];
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

/**
 * How many auto item-generations carrying a given notes marker have
 * happened today (Central time)? AUTO_NOTE = Phase B new items,
 * AUTO_RECYCLE_NOTE = Phase C backfill/recycling — separate budgets.
 */
async function itemGenerationsToday(
  now: Date,
  note: string
): Promise<number> {
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
        eq(socialDrafts.notes, note),
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
 * Phase C: find an item to re-promote. Two pools, in priority order:
 *
 *  1. BACKFILL — active items older than the Phase B freshness window
 *     that never got any drafts (captured before automation existed, or
 *     arrived faster than the daily budget).
 *  2. RECYCLE — active items unsold ≥30 days whose latest promotion is
 *     ≥21 days old (the research's repost cooldown), longest-neglected
 *     first.
 *
 * Returns the item id plus how many promotion rounds it has had (to
 * shift the channel rotation).
 */
async function findItemNeedingRecycle(
  now: Date
): Promise<{ id: string; rounds: number } | null> {
  // Promotion history per item, straight from the drafts table.
  const history = await db
    .select({
      sourceId: socialDrafts.sourceId,
      lastGen: max(socialDrafts.createdAt),
      generations: sql<number>`count(distinct ${socialDrafts.generationId})::int`,
    })
    .from(socialDrafts)
    .where(eq(socialDrafts.sourceType, "item"))
    .groupBy(socialDrafts.sourceId);
  const bySource = new Map(history.map((h) => [h.sourceId, h]));
  const promotedIds = history.map((h) => h.sourceId);

  const freshnessCutoff = new Date(
    now.getTime() - ITEM_FRESHNESS_DAYS * 86_400_000
  );

  // Pool 1: never promoted, past the Phase B window. Oldest first.
  const backfill = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.status, "active"),
        isNotNull(items.slug),
        isNotNull(items.heroImage),
        lte(items.capturedAt, freshnessCutoff),
        promotedIds.length > 0
          ? notInArray(sql`${items.id}::text`, promotedIds)
          : undefined
      )
    )
    .orderBy(asc(items.capturedAt))
    .limit(1);
  if (backfill[0]) return { id: backfill[0].id, rounds: 0 };

  // Pool 2: promoted before, but stale. Eligible when old enough AND
  // past the cooldown since the last generation.
  if (promotedIds.length === 0) return null;
  const ageCutoff = new Date(
    now.getTime() - RECYCLE_MIN_AGE_DAYS * 86_400_000
  );
  const cooldownCutoff = new Date(
    now.getTime() - RECYCLE_COOLDOWN_DAYS * 86_400_000
  );

  const candidates = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.status, "active"),
        isNotNull(items.slug),
        isNotNull(items.heroImage),
        lte(items.capturedAt, ageCutoff),
        inArray(sql`${items.id}::text`, promotedIds)
      )
    );

  let best: { id: string; rounds: number; lastGen: Date } | null = null;
  for (const c of candidates) {
    const h = bySource.get(c.id);
    if (!h?.lastGen) continue;
    const lastGen = new Date(h.lastGen);
    if (lastGen.getTime() > cooldownCutoff.getTime()) continue; // still cooling down
    if (!best || lastGen.getTime() < best.lastGen.getTime()) {
      best = { id: c.id, rounds: h.generations ?? 1, lastGen };
    }
  }
  return best ? { id: best.id, rounds: best.rounds } : null;
}

/**
 * Run at most one auto-generation. Hauls take priority (they're rarer
 * and time-sensitive); then new items, then recycling — each subject to
 * its own daily cap.
 */
export async function runAutoGeneration(
  now: Date = new Date()
): Promise<AutoGenResult> {
  let kind: "haul" | "item";
  let sourceId: string | null;
  let channels: ChannelKey[];
  let contentType: "new-haul" | "just-listed" | "throwback";
  let note = AUTO_NOTE;

  // 1. Haul without drafts?
  sourceId = await findHaulNeedingDrafts();
  if (sourceId) {
    kind = "haul";
    channels = ALL_CHANNELS;
    contentType = "new-haul";
  } else {
    // 2. Newly captured item, if today's budget allows.
    const usedNew = await itemGenerationsToday(now, AUTO_NOTE);
    sourceId =
      usedNew < ITEM_GENERATIONS_PER_DAY ? await findItemNeedingDrafts() : null;
    if (sourceId) {
      kind = "item";
      channels = channelsForItem(sourceId);
      contentType = "just-listed";
    } else {
      // 3. Phase C: backfill / recycle unsold inventory, on its own budget.
      const usedRecycle = await itemGenerationsToday(now, AUTO_RECYCLE_NOTE);
      if (usedRecycle >= RECYCLE_GENERATIONS_PER_DAY) {
        return {
          generated: false,
          skippedReason: `Daily caps reached (new ${usedNew}/${ITEM_GENERATIONS_PER_DAY}, recycle ${usedRecycle}/${RECYCLE_GENERATIONS_PER_DAY})`,
        };
      }
      const recycle = await findItemNeedingRecycle(now);
      if (!recycle) {
        return { generated: false, skippedReason: "Nothing needs drafts" };
      }
      kind = "item";
      sourceId = recycle.id;
      note = AUTO_RECYCLE_NOTE;
      channels =
        recycle.rounds === 0
          ? channelsForItem(recycle.id) // backfill: full first-time treatment
          : channelsForRecycle(recycle.id, recycle.rounds);
      contentType = recycle.rounds === 0 ? "just-listed" : "throwback";
    }
  }

  // Paused channels (e.g. Pinterest while API approval is pending) are
  // skipped at generation time — no drafts created to rot in Failed.
  const disabled = disabledChannels();
  channels = channels.filter((c) => !disabled.has(c));
  if (channels.length === 0) {
    return { generated: false, skippedReason: "All target channels disabled" };
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
          notes: note,
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
