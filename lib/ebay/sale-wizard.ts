// Monthly sale wizard — spreads every eligible store category across the
// next 4 weeks, one 2-day markdown sale each, at a single discount
// (default 20%).
//
// Design notes:
//  - The plan is DETERMINISTIC for a given (monthStart, category list):
//    categories sort by name and category i starts on day
//    floor(i * 28 / N). Preview and execute recompute the same plan, and
//    execution happens in client-driven chunks (a few eBay calls per
//    request) so the 60s serverless limit is never at risk.
//  - Idempotent: each sale carries scope.autoTierKey "wizard:<YYYY-MM>:
//    <categoryId>". Re-running the wizard (or resuming after an error)
//    skips categories that already have a sale this month.
//  - Tier-sale priority: listings already claimed by an overlapping
//    stale-inventory tier sale are excluded via ruleCriteria
//    .excludeListingIds (intersected with the category's own listings,
//    so the exclude list stays small).

import { randomUUID } from "crypto";
import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ebayListings,
  ebaySales,
  ebaySaleAuditLog,
  ebayStoreCategories,
  socialDrafts,
} from "@/db/schema";
import { sellApi, SellApiError } from "@/lib/ebay/sell-api";
import { nextSlotFor } from "@/lib/social/schedule";
import type { ChannelKey } from "@/lib/social/channel-styles";

export type WizardPlanEntry = {
  categoryId: string;
  categoryName: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  /** Set during preview when this category already has a sale this month. */
  alreadyCreated?: boolean;
};

const SALE_DURATION_DAYS = 2;
const SPREAD_DAYS = 28;

export function wizardMonthLabel(monthStart: Date): string {
  const y = monthStart.getUTCFullYear();
  const m = String(monthStart.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function wizardKeyFor(monthStart: Date, categoryId: string): string {
  return `wizard:${wizardMonthLabel(monthStart)}:${categoryId}`;
}

/** Eligible categories: everything except the "Other" bucket. */
async function loadEligibleCategories(): Promise<
  { categoryId: string; name: string }[]
> {
  const cats = await db
    .select({
      categoryId: ebayStoreCategories.categoryId,
      name: ebayStoreCategories.name,
      isOtherBucket: ebayStoreCategories.isOtherBucket,
    })
    .from(ebayStoreCategories)
    .orderBy(asc(ebayStoreCategories.name));
  return cats
    .filter((c) => !c.isOtherBucket)
    .map((c) => ({ categoryId: c.categoryId, name: c.name }));
}

/** Build the deterministic month plan. */
export async function buildWizardPlan(
  monthStart: Date
): Promise<WizardPlanEntry[]> {
  const cats = await loadEligibleCategories();
  const n = cats.length;
  if (n === 0) return [];

  // Which categories already have a wizard sale this month?
  const monthPrefix = `wizard:${wizardMonthLabel(monthStart)}:`;
  const existing = await db
    .select({ scope: ebaySales.scope })
    .from(ebaySales)
    .where(
      and(
        inArray(ebaySales.status, ["SCHEDULED", "RUNNING", "ENDED"]),
        sql`${ebaySales.scope}->>'autoTierKey' LIKE ${monthPrefix + "%"}`
      )
    );
  const createdKeys = new Set(
    existing
      .map((e) => (e.scope as { autoTierKey?: string }).autoTierKey)
      .filter((k): k is string => !!k)
  );

  return cats.map((cat, i) => {
    const dayOffset = Math.floor((i * SPREAD_DAYS) / n);
    const startsAt = new Date(monthStart.getTime() + dayOffset * 86_400_000);
    const endsAt = new Date(
      startsAt.getTime() + SALE_DURATION_DAYS * 86_400_000
    );
    return {
      categoryId: cat.categoryId,
      categoryName: cat.name,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      alreadyCreated: createdKeys.has(wizardKeyFor(monthStart, cat.categoryId)),
    };
  });
}

/**
 * Listing ids in this category that an overlapping tier sale already
 * claims — these get excluded so an item is never in two sales.
 */
async function excludeIdsForCategory(
  categoryId: string,
  windowStart: Date,
  windowEnd: Date
): Promise<string[]> {
  // Listings claimed by overlapping non-wizard auto sales.
  const tierSales = await db
    .select({ scope: ebaySales.scope })
    .from(ebaySales)
    .where(
      and(
        inArray(ebaySales.status, ["SCHEDULED", "RUNNING"]),
        lte(ebaySales.startsAt, windowEnd),
        gte(ebaySales.endsAt, windowStart),
        sql`${ebaySales.scope}->>'autoTierKey' NOT LIKE 'wizard:%'`,
        sql`${ebaySales.scope}->>'autoTierKey' IS NOT NULL`
      )
    );
  const claimed = new Set<string>();
  for (const s of tierSales) {
    const ids = (s.scope as { listingIds?: string[] }).listingIds ?? [];
    for (const id of ids) claimed.add(id);
  }
  if (claimed.size === 0) return [];

  // Intersect with this category's listings to keep the list small.
  const catListings = await db
    .select({ itemId: ebayListings.itemId })
    .from(ebayListings)
    .where(
      or(
        eq(ebayListings.storeCategory1Id, categoryId),
        eq(ebayListings.storeCategory2Id, categoryId)
      )
    );
  const ids = catListings
    .map((l) => l.itemId)
    .filter((id) => claimed.has(id));
  // eBay caps exclude lists like include lists — stay under 500.
  return ids.slice(0, 500);
}

export type WizardChunkResult = {
  processed: number;
  created: number;
  skipped: number;
  errors: string[];
};

/**
 * Execute a slice of the plan (client drives chunking). Recomputes the
 * deterministic plan and processes entries [offset, offset+limit).
 */
export async function executeWizardChunk(opts: {
  monthStart: Date;
  discountPercent: number;
  offset: number;
  limit: number;
}): Promise<WizardChunkResult & { total: number; done: boolean }> {
  const { monthStart, discountPercent, offset, limit } = opts;
  const plan = await buildWizardPlan(monthStart);
  const slice = plan.slice(offset, offset + limit);
  const result: WizardChunkResult = {
    processed: 0,
    created: 0,
    skipped: 0,
    errors: [],
  };

  const promotionImageUrl =
    process.env.EBAY_PROMOTION_IMAGE_URL ||
    "https://www.foundinalabama.com/photos/bookshelf.jpg";

  for (const entry of slice) {
    result.processed++;
    if (entry.alreadyCreated) {
      result.skipped++;
      continue;
    }
    const tierKey = wizardKeyFor(monthStart, entry.categoryId);
    const startsAt = new Date(entry.startsAt);
    const endsAt = new Date(entry.endsAt);

    try {
      const excludeListingIds = await excludeIdsForCategory(
        entry.categoryId,
        startsAt,
        endsAt
      );

      const name = `${entry.categoryName} ${Math.round(discountPercent)}% off`.slice(
        0,
        90
      );
      const ebayPayload = {
        name,
        description: name,
        marketplaceId: "EBAY_US",
        promotionStatus: "SCHEDULED",
        startDate: startsAt.toISOString(),
        endDate: endsAt.toISOString(),
        promotionImageUrl,
        selectedInventoryDiscounts: [
          {
            inventoryCriterion: {
              inventoryCriterionType: "INVENTORY_BY_RULE",
              ruleCriteria: {
                selectionRules: [
                  {
                    categoryIds: [entry.categoryId],
                    categoryScope: "STORE",
                  },
                ],
                ...(excludeListingIds.length > 0
                  ? { excludeListingIds }
                  : {}),
              },
            },
            discountBenefit: {
              percentageOffItem: String(Math.round(discountPercent)),
            },
          },
        ],
      };

      const [localRow] = await db
        .insert(ebaySales)
        .values({
          saleType: "MARKDOWN_CATEGORY",
          status: "DRAFT",
          name,
          description: `Monthly wizard sale for "${entry.categoryName}"`,
          discountPercent: String(discountPercent),
          scope: { categoryIds: [entry.categoryId], autoTierKey: tierKey },
          startsAt,
          endsAt,
        })
        .returning({ id: ebaySales.id });

      try {
        const resp = await sellApi<{ promotionId?: string }>(
          "/sell/marketing/v1/item_price_markdown",
          { method: "POST", body: ebayPayload }
        );
        await db
          .update(ebaySales)
          .set({
            status: "SCHEDULED",
            ebayPromotionId: resp.promotionId ?? null,
            updatedAt: new Date(),
          })
          .where(eq(ebaySales.id, localRow.id));
        await db.insert(ebaySaleAuditLog).values({
          saleId: localRow.id,
          action: "wizard-create",
          success: true,
          details: {
            tierKey,
            excluded: excludeListingIds.length,
            ebayResponse: resp as Record<string, unknown>,
          },
        });
        result.created++;
      } catch (err) {
        const msg =
          err instanceof SellApiError
            ? `Sell API HTTP ${err.status}: ${err.body.slice(0, 600)}`
            : err instanceof Error
              ? err.message
              : "unknown";
        await db
          .update(ebaySales)
          .set({
            status: "FAILED",
            lastError: msg.slice(0, 1000),
            updatedAt: new Date(),
          })
          .where(eq(ebaySales.id, localRow.id));
        await db.insert(ebaySaleAuditLog).values({
          saleId: localRow.id,
          action: "wizard-create",
          success: false,
          errorMessage: msg.slice(0, 1000),
          details: { tierKey, ebayPayload },
        });
        result.errors.push(`${entry.categoryName}: ${msg}`);
      }
    } catch (err) {
      result.errors.push(
        `${entry.categoryName}: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  return {
    ...result,
    total: plan.length,
    done: offset + limit >= plan.length,
  };
}

// ─── Weekly sale-announcement social drafts ──────────────────────────────────

function storeUrl(): string {
  const user = process.env.EBAY_STORE_USERNAME || "yellowhammeryields";
  return `https://www.ebay.com/str/${user}`;
}

function weekCategoryNames(
  plan: WizardPlanEntry[],
  monthStart: Date,
  week: number
): string[] {
  const names: string[] = [];
  for (const e of plan) {
    const dayOffset = Math.floor(
      (new Date(e.startsAt).getTime() - monthStart.getTime()) / 86_400_000
    );
    if (Math.floor(dayOffset / 7) === week) names.push(e.categoryName);
  }
  return names;
}

function namesBlurb(names: string[], max: number): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/**
 * Enqueue one factual sale-announcement draft per week of the sale
 * month, rotated across the link-friendly channels. Idempotent per
 * month. Drafts are inserted pre-scheduled into each channel's normal
 * posting window, so the publish cron just sends them when due.
 */
export async function createWizardSocialDrafts(
  monthStart: Date,
  discountPercent: number
): Promise<number> {
  const sourceId = `wizard:${wizardMonthLabel(monthStart)}`;
  const existing = await db
    .select({ id: socialDrafts.id })
    .from(socialDrafts)
    .where(
      and(
        eq(socialDrafts.sourceType, "sale"),
        eq(socialDrafts.sourceId, sourceId)
      )
    )
    .limit(1);
  if (existing.length > 0) return 0; // already enqueued this month

  const plan = await buildWizardPlan(monthStart);
  if (plan.length === 0) return 0;

  const pct = Math.round(discountPercent);
  const url = storeUrl();
  const channelRotation: ChannelKey[] = [
    "facebook",
    "twitter",
    "bluesky",
    "facebook",
  ];
  const now = new Date();
  let created = 0;

  for (let week = 0; week < 4; week++) {
    const names = weekCategoryNames(plan, monthStart, week);
    if (names.length === 0) continue;
    const channel = channelRotation[week];
    const weekStart = new Date(monthStart.getTime() + week * 7 * 86_400_000);
    const notBefore = weekStart.getTime() > now.getTime() ? weekStart : now;
    const slot = nextSlotFor(channel, [], notBefore);
    if (!slot) continue;

    let text: string;
    if (channel === "bluesky") {
      // 300-char budget including the URL.
      text = `This week at our eBay store: ${pct}% off ${namesBlurb(names, 3)}. Two days per category.\n\n${url}`;
      if (text.length > 295) {
        text = `This week at our eBay store: ${pct}% off ${namesBlurb(names, 2)}.\n\n${url}`;
      }
    } else if (channel === "twitter") {
      text = `${pct}% off this week at our eBay store: ${namesBlurb(names, 3)}. Each category runs two days.\n\n${url}`;
    } else {
      text = `This week's sales at our eBay store: ${pct}% off ${namesBlurb(names, 6)}. Each category is marked down for two days, then the next batch rotates in.\n\n${url}`;
    }

    // Facebook (via Publer) requires an image; use the same photo the
    // eBay promotions use so the visuals match.
    const sourceImage =
      process.env.EBAY_PROMOTION_IMAGE_URL ||
      "https://www.foundinalabama.com/photos/bookshelf.jpg";

    await db.insert(socialDrafts).values({
      sourceType: "sale",
      sourceId,
      sourceTitle: `Monthly eBay sale — week ${week + 1}`,
      sourceImage,
      sourceUrl: url,
      generationId: randomUUID(),
      contentType: "sale-announcement",
      channel,
      content: { text },
      status: "scheduled",
      scheduledFor: slot,
      notes: "auto-wizard",
    });
    created++;
  }
  return created;
}
