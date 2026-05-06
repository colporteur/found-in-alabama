// POST /api/admin/ebay/pull-listings
// Body: { pageNumber?: number, entriesPerPage?: number }
//
// Pulls ONE page of active listings from eBay's GetSellerList, filters to
// listings whose Store Category 1 is the seller's "Other" bucket and whose
// Store Category 2 is empty, and upserts the matches into ebay_listings.
//
// Returns whether more pages exist so the client can drive a multi-page
// pull without ever risking the 60s Vercel function timeout.
//
// Client orchestration pattern (see PullListingsCard.tsx):
//   page = 1
//   loop:
//     POST { pageNumber: page }
//     update UI with progress
//     if !res.hasMore break
//     page += 1

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { ebayListings, ebayStoreCategories, ebaySyncLog } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { tradingCall } from "@/lib/ebay/client";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PullBody {
  pageNumber?: number;
  entriesPerPage?: number;
  /**
   * If true, the route fetches one page and returns the first few raw
   * normalized listings without writing to the DB. Used to verify that
   * Storefront / StoreCategoryID is actually present in eBay's response
   * when matched count is zero unexpectedly.
   */
  debug?: boolean;
}

interface PullResponse {
  ok: boolean;
  pageNumber: number;
  totalPages: number;
  hasMore: boolean;
  scannedThisPage: number;
  matchedThisPage: number;
  otherCategoryId?: string;
  otherCategoryName?: string;
  durationMs: number;
  error?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body: PullBody = await req.json().catch(() => ({}));
  const pageNumber = Math.max(1, Number(body.pageNumber) || 1);
  const entriesPerPage = Math.min(200, Math.max(1, Number(body.entriesPerPage) || 100));

  const start = Date.now();

  try {
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

    // Single GetSellerList call for the requested page. Smaller page size
    // keeps the eBay response and our XML parsing well under memory limits.
    const now = new Date();
    const future = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);

    // DetailLevel=ReturnAll (with NO GranularityLevel) returns the full Item
    // payload including Storefront. We previously tried two narrower
    // approaches that both came back with empty data:
    //   - GranularityLevel=Coarse → strips Storefront entirely
    //   - OutputSelector with paths → eBay only honored the first selector
    //     and returned just ItemID for everything else
    // ReturnAll is heavier on the wire, but with EntriesPerPage capped at
    // 50 in this debug-friendly mode the per-page response stays manageable.
    const res = await tradingCall("GetSellerList", {
      EndTimeFrom: now.toISOString(),
      EndTimeTo: future.toISOString(),
      DetailLevel: "ReturnAll",
      Pagination: { EntriesPerPage: entriesPerPage, PageNumber: pageNumber },
    });

    const itemArray = (res as { ItemArray?: { Item?: unknown } }).ItemArray;
    const rawItems = itemArray?.Item;
    const arr = !rawItems ? [] : Array.isArray(rawItems) ? rawItems : [rawItems];

    const totalPages = Number(
      (res as { PaginationResult?: { TotalNumberOfPages?: unknown } })
        .PaginationResult?.TotalNumberOfPages ?? 1
    );

    let normalized = arr.map((i) => normalizeListing(i));

    // Debug short-circuit: don't filter, don't write — just return what
    // we actually saw so we can diagnose mismatches. In debug mode we also
    // pull a few extra pages and aggregate per-category counts so the user
    // can identify which category is functionally their "Other" bucket.
    if (body.debug) {
      const debugPages = 3;
      for (let p = pageNumber + 1; p <= pageNumber + debugPages - 1 && p <= totalPages; p++) {
        const next = await tradingCall("GetSellerList", {
          EndTimeFrom: now.toISOString(),
          EndTimeTo: future.toISOString(),
          DetailLevel: "ReturnAll",
          Pagination: { EntriesPerPage: entriesPerPage, PageNumber: p },
        });
        const nextArr = (next as { ItemArray?: { Item?: unknown } }).ItemArray
          ?.Item;
        const nextItems = !nextArr
          ? []
          : Array.isArray(nextArr)
          ? nextArr
          : [nextArr];
        normalized = normalized.concat(nextItems.map((i) => normalizeListing(i)));
      }

      // Aggregate per-storeCategory1Id counts across the sampled listings,
      // and join with our local ebay_store_categories cache to surface the
      // human-readable name of each category.
      const counts = new Map<string | null, number>();
      for (const l of normalized) {
        const key = l.storeCategory1Id;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const knownCategories = await db
        .select({
          categoryId: ebayStoreCategories.categoryId,
          name: ebayStoreCategories.name,
          isOtherBucket: ebayStoreCategories.isOtherBucket,
          isAlabamaRelated: ebayStoreCategories.isAlabamaRelated,
        })
        .from(ebayStoreCategories);
      const nameById = new Map(knownCategories.map((c) => [c.categoryId, c]));

      const breakdown = Array.from(counts.entries())
        .map(([categoryId, count]) => ({
          categoryId,
          count,
          name: categoryId ? nameById.get(categoryId)?.name ?? "(not in synced tree)" : "(no category set)",
          isOtherBucket: categoryId
            ? !!nameById.get(categoryId)?.isOtherBucket
            : false,
        }))
        .sort((a, b) => b.count - a.count);

      const sample = normalized.slice(0, 3);
      const stats = {
        sampledListings: normalized.length,
        sampledPages: Math.min(debugPages, totalPages - pageNumber + 1),
        withStorefront: normalized.filter((l) => l.storeCategory1Id != null).length,
        withSecondStoreCat: normalized.filter((l) => l.storeCategory2Id != null).length,
        wouldMatchCurrentFilter: normalized.filter(
          (l) =>
            l.storeCategory1Id === other.categoryId && !l.storeCategory2Id
        ).length,
      };
      return NextResponse.json({
        ok: true,
        debug: true,
        otherCategoryId: other.categoryId,
        otherCategoryName: other.name,
        pageNumber,
        totalPages,
        stats,
        breakdown,
        sample,
        durationMs: Date.now() - start,
      });
    }

    // Filter to "Other" with no second category. Same logic as the iterator
    // version, kept inline so this route is self-contained and easy to read.
    const matched = normalized.filter(
      (l) =>
        l.storeCategory1Id === other.categoryId && !l.storeCategory2Id
    );

    if (matched.length > 0) {
      const rows = matched.map((l) => ({
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
    }

    await db.insert(ebaySyncLog).values({
      action: "pull-listings-page",
      success: true,
      itemCount: matched.length,
      details: {
        otherCategoryId: other.categoryId,
        pageNumber,
        totalPages,
        scanned: arr.length,
        matched: matched.length,
      },
      startedAt: new Date(start),
      endedAt: new Date(),
    });

    const response: PullResponse = {
      ok: true,
      pageNumber,
      totalPages,
      hasMore: pageNumber < totalPages,
      scannedThisPage: arr.length,
      matchedThisPage: matched.length,
      otherCategoryId: other.categoryId,
      otherCategoryName: other.name,
      durationMs: Date.now() - start,
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = (err as Error).message;
    await db
      .insert(ebaySyncLog)
      .values({
        action: "pull-listings-page",
        success: false,
        errorMessage: message,
        details: { pageNumber },
        startedAt: new Date(start),
        endedAt: new Date(),
      })
      .catch(() => {});
    return NextResponse.json(
      {
        ok: false,
        error: message,
        pageNumber,
        durationMs: Date.now() - start,
      },
      { status: 500 }
    );
  }
}

interface NormalizedListing {
  itemId: string;
  sku: string | null;
  title: string;
  primaryImageUrl: string | null;
  storeCategory1Id: string | null;
  storeCategory2Id: string | null;
  siteCategoryId: string | null;
  siteCategoryName: string | null;
  listingType: string | null;
  quantity: number | null;
  price: string | null;
}

function nullIfZero(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || s === "0") return null;
  return s;
}

function normalizeListing(item: unknown): NormalizedListing {
  const i = item as Record<string, unknown>;
  const storefront = (i.Storefront as Record<string, unknown> | undefined) ?? {};
  const primaryCat = (i.PrimaryCategory as Record<string, unknown> | undefined) ?? {};
  const sellingStatus =
    (i.SellingStatus as Record<string, unknown> | undefined) ?? {};
  const pictureDetails =
    (i.PictureDetails as Record<string, unknown> | undefined) ?? {};
  const pictureUrl = pictureDetails.PictureURL;

  return {
    itemId: String(i.ItemID ?? ""),
    sku: i.SKU != null ? String(i.SKU) : null,
    title: String(i.Title ?? ""),
    primaryImageUrl: Array.isArray(pictureUrl)
      ? String(pictureUrl[0] ?? "")
      : pictureUrl != null
      ? String(pictureUrl)
      : null,
    // eBay returns "0" in either store-category slot to mean "no category
    // set in that slot". Normalize that to null so simple !value checks work.
    storeCategory1Id: nullIfZero(storefront.StoreCategoryID),
    storeCategory2Id: nullIfZero(storefront.StoreCategory2ID),
    siteCategoryId:
      primaryCat.CategoryID != null ? String(primaryCat.CategoryID) : null,
    siteCategoryName:
      primaryCat.CategoryName != null ? String(primaryCat.CategoryName) : null,
    listingType: i.ListingType != null ? String(i.ListingType) : null,
    quantity: i.Quantity != null ? Number(i.Quantity) : null,
    price:
      sellingStatus.CurrentPrice != null
        ? String(
            (sellingStatus.CurrentPrice as Record<string, unknown>)?.["#text"] ??
              sellingStatus.CurrentPrice
          )
        : null,
  };
}
