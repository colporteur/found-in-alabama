// GET /api/admin/ebay/categorize-diagnosis — measure the "Other bucket
// leak": is the backlog old stock the categorizer never reached, or
// recreated listings whose store category reverted?
//
// Key signal: listing START TIME. A Nifty recreate produces a NEW eBay
// listing (fresh item ID, fresh start time) built from Nifty's master
// record — which never learned the store category our categorizer set
// via ReviseItem on the OLD listing. So Other-bucket items with recent
// start times but old-inventory SKUs (low NA bins, old media dates) are
// reverted recreates, not new stock.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, ebayListings } from "@/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { getOtherCategoryId } from "@/lib/ebay/auto-categorize";
import { skuClassSql } from "@/lib/enhance/sku-class";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AGE_BUCKET = sql<string>`CASE
  WHEN ${ebayListings.startTime} IS NULL THEN 'unknown'
  WHEN ${ebayListings.startTime} > now() - interval '7 days' THEN 'a_under7d'
  WHEN ${ebayListings.startTime} > now() - interval '30 days' THEN 'b_7to30d'
  WHEN ${ebayListings.startTime} > now() - interval '90 days' THEN 'c_30to90d'
  ELSE 'd_over90d'
END`;

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const otherId = await getOtherCategoryId();
  if (!otherId) {
    return NextResponse.json(
      { error: "No Other bucket flagged — run the category sync first" },
      { status: 400 }
    );
  }

  const inOther = and(
    eq(ebayListings.storeCategory1Id, otherId),
    gt(ebayListings.quantity, 0)
  );
  const notOther = and(
    sql`${ebayListings.storeCategory1Id} IS DISTINCT FROM ${otherId}`,
    gt(ebayListings.quantity, 0)
  );

  const [otherByAge, restByAge, recentOtherByClass, totals] = await Promise.all([
    db
      .select({ bucket: AGE_BUCKET, n: sql<number>`count(*)::int` })
      .from(ebayListings)
      .where(inOther)
      .groupBy(AGE_BUCKET),
    db
      .select({ bucket: AGE_BUCKET, n: sql<number>`count(*)::int` })
      .from(ebayListings)
      .where(notOther)
      .groupBy(AGE_BUCKET),
    // Other items LISTED in the last 30 days, broken out by SKU class —
    // old bins / old media dates showing up here = reverted recreates.
    db
      .select({ cls: skuClassSql(), n: sql<number>`count(*)::int` })
      .from(ebayListings)
      .where(
        and(inOther, sql`${ebayListings.startTime} > now() - interval '30 days'`)
      )
      .groupBy(skuClassSql()),
    db
      .select({
        other: sql<number>`count(*) FILTER (WHERE ${ebayListings.storeCategory1Id} = ${otherId})::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(ebayListings)
      .where(gt(ebayListings.quantity, 0)),
  ]);

  const fmt = (rows: { bucket: string; n: number }[]) =>
    Object.fromEntries(
      rows
        .sort((a, b) => a.bucket.localeCompare(b.bucket))
        .map((r) => [r.bucket.replace(/^[a-d]_/, ""), r.n])
    );

  return NextResponse.json({
    otherBucketId: otherId,
    totals: totals[0] ?? { other: 0, total: 0 },
    otherByListingAge: fmt(otherByAge),
    nonOtherByListingAge: fmt(restByAge),
    recentlyListedOtherBySkuClass: Object.fromEntries(
      recentOtherByClass.map((r) => [r.cls, r.n])
    ),
    howToRead:
      "If otherByListingAge clusters under 30 days while the SKU classes there are old inventory (low NA bins, old media dates), recreates are reverting categorized items. If over90d dominates, the categorizer simply never reached them.",
  });
}
