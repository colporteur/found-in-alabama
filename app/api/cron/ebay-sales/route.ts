// GET /api/cron/ebay-sales — weekly stale-inventory sale maintenance.
//
// For each ENABLED tier in the config (see lib/ebay/sale-tiers.ts):
//   1. If the tier already has a live auto-sale (local row SCHEDULED or
//      RUNNING with ≥3 days left), leave it alone.
//   2. Otherwise select the tier's current eBay listings by age and
//      create a new SCHEDULED markdown promotion (INVENTORY_BY_VALUE,
//      explicit listing ids) running 30 days from tomorrow. Fully live:
//      it activates itself on the start date.
//
// Each cycle re-selects listings, so items that sold or aged into the
// next tier naturally drop out / move on the next refresh.
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
import { getTiers, listingIdsForTier } from "@/lib/ebay/sale-tiers";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const summary = {
    tiersEnabled: 0,
    salesCreated: 0,
    skipped: [] as string[],
    errors: [] as string[],
  };

  const tiers = await getTiers();
  const enabled = tiers.filter((t) => t.enabled);
  summary.tiersEnabled = enabled.length;

  for (const tier of enabled) {
    try {
      // Is there already a live auto-sale for this tier with ≥3 days left?
      const horizon = new Date(now.getTime() + 3 * 86_400_000);
      const existing = await db
        .select({ id: ebaySales.id, endsAt: ebaySales.endsAt })
        .from(ebaySales)
        .where(
          and(
            inArray(ebaySales.status, ["SCHEDULED", "RUNNING"]),
            gte(ebaySales.endsAt, horizon),
            sql`${ebaySales.scope}->>'autoTierKey' = ${tier.key}`
          )
        )
        .limit(1);
      if (existing.length > 0) {
        summary.skipped.push(`${tier.key}: live sale exists`);
        continue;
      }

      const listingIds = await listingIdsForTier(tier, tiers, now);
      if (listingIds.length === 0) {
        summary.skipped.push(`${tier.key}: no eligible listings`);
        continue;
      }

      // Start tomorrow (comfortable buffer over eBay's clock), run 30 days.
      const startDate = new Date(now.getTime() + 86_400_000);
      const endDate = new Date(startDate.getTime() + 30 * 86_400_000);
      const months = Math.round(tier.minAgeDays / 30);
      const name = `Vault find ${tier.discountPercent}% off (${months}+ months)`.slice(
        0,
        90
      );

      const promotionImageUrl =
        process.env.EBAY_PROMOTION_IMAGE_URL ||
        "https://www.foundinalabama.com/photos/bookshelf.jpg";

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
              listingIds,
            },
            discountBenefit: {
              percentageOffItem: String(Math.round(tier.discountPercent)),
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
          description: `Auto tier ${tier.key}: ${listingIds.length} listings`,
          discountPercent: String(tier.discountPercent),
          scope: { listingIds, autoTierKey: tier.key },
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
            tier: tier.key,
            listingCount: listingIds.length,
            ebayResponse: resp as Record<string, unknown>,
          },
        });
        summary.salesCreated++;
        console.log(
          `[ebay-sales-cron] created ${tier.key} sale: ${listingIds.length} listings at ${tier.discountPercent}%`
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
          .set({ status: "FAILED", lastError: msg.slice(0, 1000), updatedAt: new Date() })
          .where(sql`${ebaySales.id} = ${localRow.id}`);
        await db.insert(ebaySaleAuditLog).values({
          saleId: localRow.id,
          action: "auto-create",
          success: false,
          errorMessage: msg.slice(0, 1000),
          details: { tier: tier.key, ebayPayload },
        });
        summary.errors.push(`${tier.key}: ${msg}`);
      }
    } catch (err) {
      summary.errors.push(
        `${tier.key}: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  console.log(`[ebay-sales-cron] summary:`, JSON.stringify(summary));
  return NextResponse.json(summary);
}
