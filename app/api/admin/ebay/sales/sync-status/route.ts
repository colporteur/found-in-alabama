// POST /api/admin/ebay/sales/sync-status
//
// Reconciles our ebay_sales rows with eBay's actual promotion statuses.
// Fixes the gap where a sale created here as a draft (or scheduled) is
// later activated / paused / ended in Seller Hub — eBay knows, but our
// DB didn't, so badges and the sales list drifted out of sync.
//
// Reads the Marketing API promotion list (paginated), matches by
// ebayPromotionId, and updates status + start/end dates to match eBay.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { ebaySales } from "@/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { sellApi, SellApiError, SellApiNoTokenError } from "@/lib/ebay/sell-api";

export const runtime = "nodejs";
export const maxDuration = 60;

type EbayPromotion = {
  promotionId?: string;
  promotionStatus?: string;
  startDate?: string;
  endDate?: string;
};

const VALID_STATUSES = new Set([
  "DRAFT",
  "SCHEDULED",
  "RUNNING",
  "PAUSED",
  "ENDED",
]);

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Pull all promotions (paged). 186-ish on this account; cap defensively.
    const byId = new Map<string, EbayPromotion>();
    const limit = 100;
    for (let offset = 0; offset < 1000; offset += limit) {
      const res = await sellApi<{ promotions?: EbayPromotion[]; total?: number }>(
        `/sell/marketing/v1/promotion?marketplace_id=EBAY_US&limit=${limit}&offset=${offset}`
      );
      const list = Array.isArray(res.promotions) ? res.promotions : [];
      for (const p of list) {
        if (p.promotionId) byId.set(p.promotionId, p);
      }
      if (list.length < limit) break;
    }

    // Update our rows that carry an eBay promotion id.
    const rows = await db
      .select({
        id: ebaySales.id,
        ebayPromotionId: ebaySales.ebayPromotionId,
        status: ebaySales.status,
      })
      .from(ebaySales)
      .where(isNotNull(ebaySales.ebayPromotionId));

    let updated = 0;
    let unmatched = 0;
    for (const row of rows) {
      const remote = row.ebayPromotionId
        ? byId.get(row.ebayPromotionId)
        : undefined;
      if (!remote) {
        unmatched++;
        continue;
      }
      const remoteStatus =
        typeof remote.promotionStatus === "string"
          ? remote.promotionStatus.toUpperCase()
          : null;
      if (!remoteStatus || !VALID_STATUSES.has(remoteStatus)) continue;
      if (remoteStatus === row.status) continue;

      const patch: Record<string, unknown> = {
        status: remoteStatus,
        updatedAt: new Date(),
      };
      if (remote.startDate) {
        const d = new Date(remote.startDate);
        if (!Number.isNaN(d.getTime())) patch.startsAt = d;
      }
      if (remote.endDate) {
        const d = new Date(remote.endDate);
        if (!Number.isNaN(d.getTime())) patch.endsAt = d;
      }
      await db.update(ebaySales).set(patch).where(eq(ebaySales.id, row.id));
      updated++;
    }

    return NextResponse.json({
      ok: true,
      promotionsFetched: byId.size,
      localRows: rows.length,
      updated,
      unmatched,
    });
  } catch (err) {
    if (err instanceof SellApiNoTokenError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg =
      err instanceof SellApiError
        ? `Sell API HTTP ${err.status}: ${err.body.slice(0, 400)}`
        : err instanceof Error
          ? err.message
          : "Sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
