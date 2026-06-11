// POST /api/admin/ebay/sales/test-connection
// Calls a Sell Marketing API endpoint to verify the OAuth chain works.
// Read-only — no data is written or modified.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sellApi, SellApiError, SellApiNoTokenError } from "@/lib/ebay/sell-api";

export const runtime = "nodejs";
export const maxDuration = 30;

interface PromotionListResponse {
  total?: number;
  promotions?: unknown[];
}

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    // No promotion_status filter — eBay rejects comma-separated status
    // lists with errorId 38240 ("Invalid input for the 'promotionStatus'
    // field"), and the test only needs to prove the OAuth chain works.
    const res = await sellApi<PromotionListResponse>(
      "/sell/marketing/v1/promotion?marketplace_id=EBAY_US&limit=10"
    );
    const promotionsCount =
      typeof res.total === "number"
        ? res.total
        : Array.isArray(res.promotions)
        ? res.promotions.length
        : 0;
    return NextResponse.json({
      ok: true,
      promotionsCount,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    if (err instanceof SellApiNoTokenError) {
      return NextResponse.json(
        { ok: false, error: err.message, durationMs: Date.now() - start },
        { status: 401 }
      );
    }
    if (err instanceof SellApiError) {
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          status: err.status,
          body: err.body.slice(0, 800),
          durationMs: Date.now() - start,
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        durationMs: Date.now() - start,
      },
      { status: 500 }
    );
  }
}
