// GET /api/cron/ebay-sales — weekly stale-inventory sale maintenance.
//
// Two passes (see lib/ebay/sale-tiers.ts):
//
//  1. AGE TIERS — items selected by true age (SKU date when parseable,
//     else listing StartTime). Highest priority.
//  2. BIN TIERS — items selected by bin number (NA## SKUs), excluding
//     anything an enabled age tier already claims, so no item is ever
//     in two sales.
//
// For each enabled tier with no live sale (SCHEDULED/RUNNING with ≥3
// days left), select its current listings and create fully-live
// SCHEDULED markdowns running 30 days from tomorrow. eBay caps one
// markdown at 500 listings, so big tiers split into "(part N)"
// promotions. Each refresh cycle re-selects listings, so sold or
// aged-out items rotate automatically.
//
// Auth: same CRON_SECRET pattern as /api/cron/publish. Runs weekly via
// GitHub Actions (.github/workflows/ebay-sales-cron.yml); safe to
// trigger manually as a logged-in admin.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { ebaySales, ebaySaleAuditLog } from "@/db/schema";
import { and, gte, inArray, sql } from "drizzle-orm";
import { sellApi, SellApiError } from "@/lib/ebay/sell-api";
import {
  getBinTiers,
  getTiers,
  listingIdsForBinTier,
  listingIdsForTier,
} from "@/lib/ebay/sale-tiers";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_LISTINGS_PER_PROMOTION = 500;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return true;
  const session = await auth();
  return !!session?.user;
}

interface MarketingPromotionResponse {
  promotionId?: string;
  [k: string]: unknown;
}

type RunSummary = {
  ageTiersEnabled: number;
  binTiersEnabled: number;
  salesCreated: number;
  skipped: string[];
  errors: string[];
};

/** Does this tier key already have a live sale with ≥3 days runway? */
async function hasLiveSale(tierKey: string, now: Date): Promise<boolean> {
  const horizon = new Date(now.getTime() + 3 * 86_400_000);
  const existing = await db
    .select({ id: ebaySales.id })
    .from(ebaySales)
    .where(
      and(
        inArray(ebaySales.status, ["SCHEDULED", "RUNNING"]),
        gte(ebaySales.endsAt, horizon),
        sql`${ebaySales.scope}->>'autoTierKey' = ${tierKey}`
      )
    )
    .limit(1);
  return existing.length > 0;
}

/**
 * Create fully-live markdown promotion(s) for a tier's listings,
 * splitting across multiple promotions when over eBay's 500 cap.
 * Returns how many promotions were created; pushes errors to summary.
 */
async function createTierSales(opts: {
  tierKey: string;
  baseName: string;
  discountPercent: number;
  listingIds: string[];
  now: Date;
  summary: RunSummary;
}): Promise<number> {
  const { tierKey, baseName, discountPercent, listingIds, now, summary } = opts;

  const startDate = new Date(now.getTime() + 86_400_000);
  const endDate = new Date(startDate.getTime() + 30 * 86_400_000);
  const promotionImageUrl =
    process.env.EBAY_PROMOTION_IMAGE_URL ||
    "https://www.foundinalabama.com/photos/bookshelf.jpg";

  const chunks: string[][] = [];
  for (let i = 0; i < listingIds.length; i += MAX_LISTINGS_PER_PROMOTION) {
    chunks.push(listingIds.slice(i, i + MAX_LISTINGS_PER_PROMOTION));
  }

  let created = 0;
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const name = (
      chunks.length > 1 ? `${baseName} (part ${c + 1})` : baseName
    ).slice(0, 90);

    const ebayPayload = {
      name,
      description: name,
      marketplaceId: "EBAY_US",
      promotionStatus: "SCHEDULED",
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      promotionImageUrl,
      selectedInventoryDiscounts: [
        {
          inventoryCriterion: {
            inventoryCriterionType: "INVENTORY_BY_VALUE",
            listingIds: chunk,
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
        saleType: "MARKDOWN_SKU",
        status: "DRAFT",
        name,
        description: `Auto tier ${tierKey}: ${chunk.length} listings`,
        discountPercent: String(discountPercent),
        scope: { listingIds: chunk, autoTierKey: tierKey },
        startsAt: startDate,
        endsAt: endDate,
      })
      .returning({ id: ebaySales.id });

    try {
      const resp = await sellApi<MarketingPromotionResponse>(
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
        .where(sql`${ebaySales.id} = ${localRow.id}`);
      await db.insert(ebaySaleAuditLog).values({
        saleId: localRow.id,
        action: "auto-create",
        success: true,
        details: {
          tier: tierKey,
          part: c + 1,
          parts: chunks.length,
          listingCount: chunk.length,
          ebayResponse: resp as Record<string, unknown>,
        },
      });
      created++;
      console.log(
        `[ebay-sales-cron] created ${tierKey} sale part ${c + 1}/${chunks.length}: ${chunk.length} listings at ${discountPercent}%`
      );
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
        .where(sql`${ebaySales.id} = ${localRow.id}`);
      await db.insert(ebaySaleAuditLog).values({
        saleId: localRow.id,
        action: "auto-create",
        success: false,
        errorMessage: msg.slice(0, 1000),
        details: { tier: tierKey, part: c + 1, ebayPayload },
      });
      summary.errors.push(`${tierKey} part ${c + 1}: ${msg}`);
    }
  }
  return created;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const summary: RunSummary = {
    ageTiersEnabled: 0,
    binTiersEnabled: 0,
    salesCreated: 0,
    skipped: [],
    errors: [],
  };

  const [ageTiers, binTiers] = await Promise.all([getTiers(), getBinTiers()]);
  const enabledAge = ageTiers.filter((t) => t.enabled);
  const enabledBin = binTiers.filter((t) => t.enabled);
  summary.ageTiersEnabled = enabledAge.length;
  summary.binTiersEnabled = enabledBin.length;

  // ── Pass 1: age tiers (priority). Also collect EVERY enabled age
  // tier's membership so bin tiers can exclude those listings — even
  // when the age tier's sale already exists and is skipped this run.
  const claimedByAge = new Set<string>();
  for (const tier of enabledAge) {
    try {
      const listingIds = await listingIdsForTier(tier, ageTiers, now);
      for (const id of listingIds) claimedByAge.add(id);

      if (await hasLiveSale(tier.key, now)) {
        summary.skipped.push(`${tier.key}: live sale exists`);
        continue;
      }
      if (listingIds.length === 0) {
        summary.skipped.push(`${tier.key}: no eligible listings`);
        continue;
      }
      const months = Math.round(tier.minAgeDays / 30);
      summary.salesCreated += await createTierSales({
        tierKey: tier.key,
        baseName: `Vault find ${tier.discountPercent}% off (${months}+ months)`,
        discountPercent: tier.discountPercent,
        listingIds,
        now,
        summary,
      });
    } catch (err) {
      summary.errors.push(
        `${tier.key}: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  // ── Pass 2: bin tiers, excluding everything age tiers claimed.
  for (const tier of enabledBin) {
    try {
      if (await hasLiveSale(`bin:${tier.key}`, now)) {
        summary.skipped.push(`bin:${tier.key}: live sale exists`);
        continue;
      }
      const listingIds = await listingIdsForBinTier(tier, claimedByAge);
      if (listingIds.length === 0) {
        summary.skipped.push(`bin:${tier.key}: no eligible listings`);
        continue;
      }
      const rangeLabel =
        tier.maxBin !== null
          ? `bins ${tier.minBin}–${tier.maxBin}`
          : `bins ${tier.minBin}+`;
      summary.salesCreated += await createTierSales({
        tierKey: `bin:${tier.key}`,
        baseName: `Back room ${tier.discountPercent}% off (${rangeLabel})`,
        discountPercent: tier.discountPercent,
        listingIds,
        now,
        summary,
      });
    } catch (err) {
      summary.errors.push(
        `bin:${tier.key}: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  console.log(`[ebay-sales-cron] summary:`, JSON.stringify(summary));
  return NextResponse.json(summary);
}
