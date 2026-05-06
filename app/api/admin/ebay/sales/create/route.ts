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

  // Body for POST /sell/marketing/v1/item_price_markdown/ (the markdown
  // promotion endpoint, distinct from /item_promotion). Earlier 500
  // "Internal error" was caused by including applyDiscountToSingleItemOnly
  // (that's an ItemPromotion field, not valid here) and missing markdown-
  // specific fields. ItemPriceMarkdown's actual fields:
  //   applyFreeShipping, autoSelectFutureInventory, blockPriceIncreaseInItemRevision,
  //   description, discountRules, endDate, inventoryCriterion, marketplaceId,
  //   name, priority (PRIORITY_1|PRIORITY_2|PRIORITY_3), promotionImageUrl,
  //   promotionStatus, startDate.
  // eBay requires the promotion image to be at least 500x500 pixels, JPEG
  // or PNG, under 12MB. The site's logo.png is too small (smaller icons
  // typically sit around 200-300px on the long edge), which triggers an
  // opaque "Internal error" 500 from eBay rather than a clear validation
  // error. Default to one of the haul photos in public/photos which are
  // already well above the size cutoff. Override with EBAY_PROMOTION_IMAGE_URL.
  const promotionImageUrl =
    process.env.EBAY_PROMOTION_IMAGE_URL ||
    "https://www.foundinalabama.com/photos/bookshelf.jpg";

  const ebayPayload = {
    name: body.name.slice(0, 90),
    description: (body.description ?? body.name).slice(0, 500),
    marketplaceId: "EBAY_US",
    // Create in DRAFT first — eBay validates fewer things on DRAFT than
    // SCHEDULED, and an opaque "Internal error" 500 on SCHEDULED creation
    // commonly means a seller-account precondition (e.g. unaccepted
    // Promotions Manager T&Cs) that DRAFTs are immune to. We can promote
    // to SCHEDULED in a later round once we confirm the basic shape works.
    promotionStatus: "DRAFT",
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    promotionImageUrl,
    applyFreeShipping: false,
    autoSelectFutureInventory: true,
    blockPriceIncreaseInItemRevision: true,
    priority: "PRIORITY_2",
    inventoryCriterion: {
      inventoryCriterionType: "INVENTORY_BY_RULE",
      selectionRules: [
        {
          categoryIds: body.categoryIds,
          categoryScope: "STORE",
        },
      ],
    },
    discountRules: [
      {
        discountBenefit: {
          percentageOffItem: body.discountPercent.toFixed(2),
        },
      },
    ],
  };

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
