// Social announcements for the automated stale-inventory sales.
//
// When the weekly ebay-sales cron creates a tier's markdown promotion,
// this enqueues one factual sale-announcement draft, scheduled into the
// channel's normal posting window right as the sale goes live. Template-
// based (no LLM call — the facts are already structured), idempotent per
// tier + start date, and channel-rotated by tier so successive sales
// don't all land on the same feed. UTM tagging happens at post time.

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, socialDrafts } from "@/db";
import { disabledChannels, nextSlotFor } from "@/lib/social/schedule";
import type { ChannelKey } from "@/lib/social/channel-styles";

const ROTATION: ChannelKey[] = ["facebook", "twitter", "bluesky"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function storeUrl(): string {
  const user = process.env.EBAY_STORE_USERNAME || "yellowhammeryields";
  return `https://www.ebay.com/str/${user}`;
}

/**
 * Enqueue an announcement for a freshly created tier sale. Returns
 * whether a draft was created (false = duplicate or no open channel).
 */
export async function enqueueSaleAnnouncement(opts: {
  tierKey: string;
  /** Human sale name, e.g. "Vault find 20% off (6+ months)". */
  saleName: string;
  discountPercent: number;
  listingCount: number;
  startsAt: Date;
}): Promise<boolean> {
  const { tierKey, saleName, discountPercent, listingCount, startsAt } = opts;
  const sourceId = `auto-sale:${tierKey}:${startsAt.toISOString().slice(0, 10)}`;

  const existing = await db
    .select({ id: socialDrafts.id })
    .from(socialDrafts)
    .where(
      and(eq(socialDrafts.sourceType, "sale"), eq(socialDrafts.sourceId, sourceId))
    )
    .limit(1);
  if (existing.length > 0) return false; // already announced

  const disabled = disabledChannels();
  const rotation = ROTATION.filter((c) => !disabled.has(c));
  if (rotation.length === 0) return false;
  const channel = rotation[hashString(tierKey) % rotation.length];

  const slot = nextSlotFor(channel, [], startsAt);
  if (!slot) return false;

  const pct = Math.round(discountPercent);
  const url = storeUrl();
  const count = listingCount.toLocaleString();
  const text =
    channel === "bluesky" || channel === "twitter"
      ? `${pct}% off ${count} items at our eBay store for the next 30 days — older finds making room for new hauls.\n\n${url}`
      : `We just marked down ${count} items — ${pct}% off at our eBay store for the next 30 days. These are the older finds making room for new hauls, so the good stuff hides in here.\n\n${url}`;

  const sourceImage =
    process.env.EBAY_PROMOTION_IMAGE_URL ||
    "https://www.foundinalabama.com/photos/bookshelf.jpg";

  await db.insert(socialDrafts).values({
    sourceType: "sale",
    sourceId,
    sourceTitle: saleName,
    sourceImage,
    sourceUrl: url,
    generationId: randomUUID(),
    contentType: "sale-announcement",
    channel,
    content: { text },
    status: "scheduled",
    scheduledFor: slot,
    notes: "auto-sale",
  });
  return true;
}
