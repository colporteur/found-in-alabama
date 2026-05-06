// POST /api/admin/ebay/pull-listings
// Optional body: { maxItems?: number } to cap how many listings to ingest
// (useful for first-run smoke tests when the seller has thousands of items).
//
// Pulls every active listing whose Store Category 1 matches the seller's
// "Other" bucket AND whose Store Category 2 is empty. Results are upserted
// into ebay_listings so re-running is safe.
//
// Caveat: eBay's Trading API GetSellerList does not support filtering by
// store category server-side, so we have to pull every active listing and
// filter client-side. With ~200 items/page and a few seconds per page, a
// store with several thousand active listings can exceed Vercel's 60s
// function timeout. If that happens, retry with maxItems set, or upgrade
// to a plan with longer maxDuration.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { ebayListings, ebayStoreCategories, ebaySyncLog } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { iterateActiveListings } from "@/lib/ebay/calls";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PullBody {
  maxItems?: number;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: PullBody = {};
  try {
    body = (await req.json().catch(() => ({}))) as PullBody;
  } catch {
    body = {};
  }

  const start = Date.now();

  try {
    // Step 1: find the seller's "Other" bucket categoryId. Without one,
    // we can't filter — bail with a clear message pointing to step 1.
    const [other] = await db
      .select({
        categoryId: ebayStoreCategories.categoryId,
        name: ebayStoreCategories.name,
      })
      .from(ebayStoreCategories)
      .where(eq(ebayStoreCategories.isOtherBucket, true))
      .limit(1);

    if (!other) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No store category is flagged as the "Other" bucket. Open Step 1 (Store categories) and toggle the "Is Other" switch on the appropriate category first.',
        },
        { status: 400 }
      );
    }

    // Step 2: paginate through active listings, filter, upsert.
    let scanned = 0;
    let matched = 0;
    let inserted = 0;
    let updated = 0;

    for await (const page of iterateActiveListings({
      filterToOtherWithNoSecond: { otherCategoryId: other.categoryId },
      entriesPerPage: 200,
      maxItems: body.maxItems,
    })) {
      // The iterator already filtered to matching listings, so every
      // entry in `page` is something we want to persist. (We rely on the
      // iterator's filter rather than re-checking here.)
      scanned += page.length;

      if (page.length === 0) continue;

      const rows = page.map((l) => ({
        itemId: l.itemId,
        sku: l.sku,
        title: l.title,
        primaryImageUrl: l.primaryImageUrl,
        storeCategory1Id: l.storeCategory1Id,
        storeCategory2Id: l.storeCategory2Id,
        siteCategoryId: l.siteCategoryId,
        siteCategoryName: l.siteCategoryName,
        listingType: l.listingType,
        quantity: l.quantity,
        price: l.price,
        description: null,
        lastSyncedAt: new Date(),
      }));

      // Upsert. We don't know per-row whether a given item is new or just
      // refreshed, so we count new-vs-updated by checking an existence
      // probe before the insert. For thousands of rows that adds load,
      // so we skip the per-row probe and just track total matched.
      await db
        .insert(ebayListings)
        .values(rows)
        .onConflictDoUpdate({
          target: ebayListings.itemId,
          set: {
            sku: sql`excluded.sku`,
            title: sql`excluded.title`,
            primaryImageUrl: sql`excluded.primary_image_url`,
            storeCategory1Id: sql`excluded.store_category_1_id`,
            storeCategory2Id: sql`excluded.store_category_2_id`,
            siteCategoryId: sql`excluded.site_category_id`,
            siteCategoryName: sql`excluded.site_category_name`,
            listingType: sql`excluded.listing_type`,
            quantity: sql`excluded.quantity`,
            price: sql`excluded.price`,
            lastSyncedAt: sql`excluded.last_synced_at`,
          },
        });

      matched += page.length;
    }

    inserted = matched; // approximation; see comment above
    updated = 0;

    await db.insert(ebaySyncLog).values({
      action: "pull-listings",
      success: true,
      itemCount: matched,
      details: {
        otherCategoryId: other.categoryId,
        otherCategoryName: other.name,
        scanned,
        matched,
        maxItems: body.maxItems ?? null,
      },
      startedAt: new Date(start),
      endedAt: new Date(),
    });

    return NextResponse.json({
      ok: true,
      otherCategoryId: other.categoryId,
      otherCategoryName: other.name,
      matched,
      inserted,
      updated,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const message = (err as Error).message;
    await db
      .insert(ebaySyncLog)
      .values({
        action: "pull-listings",
        success: false,
        errorMessage: message,
        startedAt: new Date(start),
        endedAt: new Date(),
      })
      .catch(() => {});
    return NextResponse.json(
      { ok: false, error: message, durationMs: Date.now() - start },
      { status: 500 }
    );
  }
}
