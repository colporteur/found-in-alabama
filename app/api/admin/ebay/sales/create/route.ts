// POST /api/admin/ebay/sales/create
//
// Body: { saleType: "MARKDOWN_CATEGORY", name, description?, discountPercent,
//         categoryIds: string[], startsAt, endsAt }
//
// Other sale types (MARKDOWN_SKU, ORDER_DISCOUNT, CODELESS_VOUCHER) will be
// added in subsequent rounds — currently only MARKDOWN_CATEGORY is wired.
//
// Flow: insert local DRAFT row → call eBay Sell Marketing API → on success
// update row with ebayPromotionId + SCHEDULED → on failure mark FAILED with
// the error body so the user can see what eBay rejected.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { ebaySales, ebaySaleAuditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sellApi, SellApiError, SellApiNoTokenError } from "@/lib/ebay/sell-api";

export const runtime = "nodejs";
export const maxDuration = 30;

interface CreateSaleBody {
  saleType?: "MARKDOWN_CATEGORY" | "MARKDOWN_SKU" | "ORDER_DISCOUNT" | "CODELESS_VOUCHER";
  name?: string;
  description?: string;
  discountPercent?: number;
  minSpendAmount?: number;
  categoryIds?: string[];
  skus?: string[];
  startsAt?: string; // ISO
  endsAt?: string; // ISO
}

interface MarketingPromotionResponse {
  promotionId?: string;
  promotionStatus?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body: CreateSaleBody = await req.json().catch(() => ({}));

  // Common validation
  if (!body.saleType) {
    return NextResponse.json({ ok: false, error: "saleType required" }, { status: 400 });
  }
  if (!body.name || body.name.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
  }
  if (!body.startsAt || !body.endsAt) {
    return NextResponse.json(
      { ok: false, error: "startsAt and endsAt required (ISO 8601)" },
      { status: 400 }
    );
  }
  const startDate = new Date(body.startsAt);
  const endDate = new Date(body.endsAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ ok: false, error: "Invalid date" }, { status: 400 });
  }
  if (endDate <= startDate) {
    return NextResponse.json(
      { ok: false, error: "endsAt must be after startsAt" },
      { status: 400 }
    );
  }
  // eBay constraints (EBAY_US): a markdown must run at least 24 hours
  // and at most 45 days. Violations come back as opaque 500s, so
  // validate here with readable messages.
  const durationMs = endDate.getTime() - startDate.getTime();
  if (durationMs < 24 * 3600_000) {
    return NextResponse.json(
      { ok: false, error: "eBay requires sales to run at least 24 hours." },
      { status: 400 }
    );
  }
  if (durationMs > 45 * 86_400_000) {
    return NextResponse.json(
      { ok: false, error: "eBay caps sales at 45 days." },
      { status: 400 }
    );
  }

  if (body.saleType !== "MARKDOWN_CATEGORY") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Only MARKDOWN_CATEGORY is implemented in this round. Other sale types arrive in subsequent rounds.",
      },
      { status: 501 }
    );
  }

  if (!body.categoryIds || body.categoryIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "categoryIds required for MARKDOWN_CATEGORY" },
      { status: 400 }
    );
  }
  if (
    typeof body.discountPercent !== "number" ||
    body.discountPercent <= 0 ||
    body.discountPercent > 80
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "discountPercent must be a number between 0 and 80",
      },
      { status: 400 }
    );
  }

  // Insert local DRAFT row first so we have an audit trail even if the
  // eBay call fails.
  const [localRow] = await db
    .insert(ebaySales)
    .values({
      saleType: body.saleType,
      status: "DRAFT",
      name: body.name.trim(),
      description: body.description?.trim() || null,
      discountPercent: String(body.discountPercent),
      scope: { categoryIds: body.categoryIds },
      startsAt: startDate,
      endsAt: endDate,
    })
    .returning({ id: ebaySales.id });

  // Body for POST /sell/marketing/v1/item_price_markdown — built to the
  // CURRENT documented schema (verified June 2026 against
  // developer.ebay.com/api-docs/sell/marketing/resources/item_price_markdown/
  // methods/createItemPriceMarkdownPromotion):
  //
  //   - The discount + inventory selection live INSIDE
  //     selectedInventoryDiscounts[] — NOT at the top level. (Our old
  //     top-level inventoryCriterion/discountRules shape was silently
  //     ignored, leaving a promotion with no discounts → eBay's opaque
  //     2003 "Internal error".)
  //   - selectionRules sit under inventoryCriterion.ruleCriteria, and
  //     each selectionRules container may hold only ONE category ID —
  //     multiple categories become multiple containers (all with the
  //     same categoryScope).
  //   - description is required.
  //   - promotionImageUrl is required for markdown sales: JPEG/PNG,
  //     ≥500x500px, ≤12MB. The site logo is too small; default to a haul
  //     photo. Override with EBAY_PROMOTION_IMAGE_URL.
  const promotionImageUrl =
    process.env.EBAY_PROMOTION_IMAGE_URL ||
    "https://www.foundinalabama.com/photos/bookshelf.jpg";

  const ebayPayload = {
    name: body.name.slice(0, 90),
    description: (body.description?.trim() || body.name).slice(0, 250),
    marketplaceId: "EBAY_US",
    // SCHEDULED = goes live on its start date with no Seller Hub step.
    promotionStatus: "SCHEDULED",
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    promotionImageUrl,
    selectedInventoryDiscounts: [
      {
        inventoryCriterion: {
          inventoryCriterionType: "INVENTORY_BY_RULE",
          ruleCriteria: {
            // One category per container, per eBay's selectionRules guide.
            selectionRules: body.categoryIds.map((id) => ({
              categoryIds: [id],
              categoryScope: "STORE",
            })),
          },
        },
        discountBenefit: {
          percentageOffItem: String(Math.round(body.discountPercent)),
        },
      },
    ],
  };

  try {
    const resp = await sellApi<MarketingPromotionResponse>(
      "/sell/marketing/v1/item_price_markdown",
      { method: "POST", body: ebayPayload }
    );

    // Created SCHEDULED — it goes live on its start date automatically.
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
      action: "create",
      success: true,
      details: { ebayResponse: resp, ebayPayload },
    });

    return NextResponse.json({
      ok: true,
      saleId: localRow.id,
      ebayPromotionId: resp.promotionId ?? null,
    });
  } catch (err) {
    const errorBody =
      err instanceof SellApiError ? err.body : (err as Error).message;
    const errorMessage =
      err instanceof SellApiNoTokenError
        ? err.message
        : err instanceof SellApiError
        ? `Sell API HTTP ${err.status}: ${err.body.slice(0, 800)}`
        : (err as Error).message;

    await db
      .update(ebaySales)
      .set({
        status: "FAILED",
        lastError: errorMessage.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(ebaySales.id, localRow.id));

    await db.insert(ebaySaleAuditLog).values({
      saleId: localRow.id,
      action: "create",
      success: false,
      errorMessage: errorMessage.slice(0, 1000),
      details: { ebayPayload, ebayResponseBody: errorBody },
    });

    // When EBAY_DEBUG=1, bake the exact request body and eBay's response
    // into the API response so it's visible in the UI without digging
    // into Vercel logs.
    const debugInfo =
      process.env.EBAY_DEBUG === "1"
        ? {
            sentBody: ebayPayload,
            sentToUrl: "/sell/marketing/v1/item_price_markdown",
            ebayResponseBody: errorBody,
          }
        : undefined;

    return NextResponse.json(
      {
        ok: false,
        saleId: localRow.id,
        error: errorMessage,
        debug: debugInfo,
      },
      { status: err instanceof SellApiNoTokenError ? 401 : 500 }
    );
  }
}
