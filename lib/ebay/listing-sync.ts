// Full eBay store → ebay_listings sync, budgeted and resumable.
//
// GetSellerList returns ~200 listings/page; a ~7000-item store is ~35
// pages. Pulling all of them server-side would blow Vercel's 60s
// function limit, so syncListingsBudgeted() pulls pages until a soft
// deadline, persists a page cursor in app_settings, and returns. The
// weekly GitHub Action calls the cron a handful of times to walk the
// whole store across short invocations.
//
// This is the "full" sync (every active listing), distinct from the
// categorizer's "Other-bucket only" pull in app/api/admin/ebay/pull-
// listings. normalizeListing is duplicated there intentionally — that
// route is load-bearing for categorization and we don't want this to
// perturb it.

import { lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, ebaySyncLog, appSettings } from "@/db/schema";
import { tradingCall } from "@/lib/ebay/client";

// When a full sweep completes, rows the sweep didn't touch are listings
// eBay no longer returns as active (ended/sold/removed) — purge them so
// the workbench and enhance batches stop targeting ghosts. A 3-day grace
// below the sweep start protects listings created mid-sweep on pages the
// walker had already passed. NOTE: this only cleans the eBay mirror; the
// Nifty `items` table (which drives sold-item display on haul pages) is
// a separate record and is never touched here.
const PURGE_GRACE_MS = 3 * 86_400_000;

const CURSOR_KEY = "listingSyncCursor";
const ENTRIES_PER_PAGE = 200;
/** If the last completed sweep is older than this, start a fresh sweep. */
const FRESH_SWEEP_AFTER_MS = 24 * 3600_000;

type Cursor = {
  page: number;
  totalPages: number;
  /** ISO; set when a full sweep finishes. */
  completedAt: string | null;
  /** ISO of the in-progress sweep's start. */
  startedAt: string | null;
  syncedThisSweep: number;
};

const EMPTY_CURSOR: Cursor = {
  page: 1,
  totalPages: 1,
  completedAt: null,
  startedAt: null,
  syncedThisSweep: 0,
};

async function loadCursor(): Promise<Cursor> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(sql`${appSettings.key} = ${CURSOR_KEY}`)
    .limit(1);
  if (!row || typeof row.value !== "object" || row.value === null) {
    return { ...EMPTY_CURSOR };
  }
  return { ...EMPTY_CURSOR, ...(row.value as Partial<Cursor>) };
}

async function saveCursor(cursor: Cursor): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: CURSOR_KEY, value: cursor, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: cursor, updatedAt: new Date() },
    });
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
  startTime: Date | null;
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
  const primaryCat =
    (i.PrimaryCategory as Record<string, unknown> | undefined) ?? {};
  const sellingStatus =
    (i.SellingStatus as Record<string, unknown> | undefined) ?? {};
  const pictureDetails =
    (i.PictureDetails as Record<string, unknown> | undefined) ?? {};
  const pictureUrl = pictureDetails.PictureURL;
  const listingDetails =
    (i.ListingDetails as Record<string, unknown> | undefined) ?? {};
  let startTime: Date | null = null;
  if (listingDetails.StartTime != null) {
    const d = new Date(String(listingDetails.StartTime));
    if (!Number.isNaN(d.getTime())) startTime = d;
  }

  // Available quantity = listed Quantity − QuantitySold. eBay keeps a
  // sold-out single-quantity listing "active" until its end time, so
  // storing AVAILABLE (not total) quantity lets the storefront's
  // quantity>0 filter drop sold items.
  const totalQty = i.Quantity != null ? Number(i.Quantity) : null;
  const qtySold =
    sellingStatus.QuantitySold != null
      ? Number(sellingStatus.QuantitySold)
      : 0;
  const available =
    totalQty != null ? Math.max(0, totalQty - qtySold) : null;

  return {
    itemId: String(i.ItemID ?? ""),
    sku: i.SKU != null ? String(i.SKU) : null,
    title: String(i.Title ?? ""),
    primaryImageUrl: Array.isArray(pictureUrl)
      ? String(pictureUrl[0] ?? "")
      : pictureUrl != null
        ? String(pictureUrl)
        : null,
    storeCategory1Id: nullIfZero(storefront.StoreCategoryID),
    storeCategory2Id: nullIfZero(storefront.StoreCategory2ID),
    siteCategoryId:
      primaryCat.CategoryID != null ? String(primaryCat.CategoryID) : null,
    siteCategoryName:
      primaryCat.CategoryName != null ? String(primaryCat.CategoryName) : null,
    listingType: i.ListingType != null ? String(i.ListingType) : null,
    quantity: available,
    price:
      sellingStatus.CurrentPrice != null
        ? String(
            (sellingStatus.CurrentPrice as Record<string, unknown>)?.["#text"] ??
              sellingStatus.CurrentPrice
          )
        : null,
    startTime,
  };
}

async function upsertPage(listings: NormalizedListing[]): Promise<number> {
  const rows = listings
    .filter((l) => l.itemId)
    .map((l) => ({
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
      startTime: l.startTime,
      lastSyncedAt: new Date(),
    }));
  if (rows.length === 0) return 0;
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
        startTime: sql`excluded.start_time`,
        lastSyncedAt: sql`excluded.last_synced_at`,
      },
    });
  return rows.length;
}

export type SyncResult = {
  ranPages: number;
  syncedThisRun: number;
  page: number;
  totalPages: number;
  sweepComplete: boolean;
};

/**
 * Pull eBay store listing pages until a soft time budget, resuming from
 * the saved cursor. Marks a "stale" listing (quantity 0) the same as
 * eBay reports it, so the storefront naturally drops sold-out items.
 */
export async function syncListingsBudgeted(
  budgetMs = 40_000
): Promise<SyncResult> {
  const deadline = Date.now() + budgetMs;
  let cursor = await loadCursor();

  // Start a fresh sweep if the prior one finished, or stalled long ago.
  const completedRecently =
    cursor.completedAt &&
    Date.now() - new Date(cursor.completedAt).getTime() < FRESH_SWEEP_AFTER_MS;
  if (cursor.completedAt && !completedRecently) {
    cursor = {
      ...EMPTY_CURSOR,
      startedAt: new Date().toISOString(),
    };
  } else if (cursor.completedAt && completedRecently) {
    // Already synced within the freshness window — nothing to do.
    return {
      ranPages: 0,
      syncedThisRun: 0,
      page: cursor.page,
      totalPages: cursor.totalPages,
      sweepComplete: true,
    };
  }
  if (!cursor.startedAt) cursor.startedAt = new Date().toISOString();

  const now = new Date();
  const future = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
  const start = Date.now();
  let ranPages = 0;
  let syncedThisRun = 0;

  while (Date.now() < deadline) {
    const res = await tradingCall("GetSellerList", {
      EndTimeFrom: now.toISOString(),
      EndTimeTo: future.toISOString(),
      DetailLevel: "ReturnAll",
      Pagination: {
        EntriesPerPage: ENTRIES_PER_PAGE,
        PageNumber: cursor.page,
      },
    });

    const itemArray = (res as { ItemArray?: { Item?: unknown } }).ItemArray;
    const rawItems = itemArray?.Item;
    const arr = !rawItems ? [] : Array.isArray(rawItems) ? rawItems : [rawItems];
    cursor.totalPages = Number(
      (res as { PaginationResult?: { TotalNumberOfPages?: unknown } })
        .PaginationResult?.TotalNumberOfPages ?? cursor.totalPages
    );

    const n = await upsertPage(arr.map((i) => normalizeListing(i)));
    syncedThisRun += n;
    cursor.syncedThisSweep += n;
    ranPages++;

    if (cursor.page >= cursor.totalPages || arr.length === 0) {
      cursor.completedAt = new Date().toISOString();
      await saveCursor(cursor);

      // Purge rows this sweep never saw (minus grace) — they're gone
      // from eBay. Anything actually active reappears next sweep anyway.
      let purged = 0;
      if (cursor.startedAt) {
        const graceCutoff = new Date(
          new Date(cursor.startedAt).getTime() - PURGE_GRACE_MS
        );
        const gone = await db
          .delete(ebayListings)
          .where(lt(ebayListings.lastSyncedAt, graceCutoff))
          .returning({ itemId: ebayListings.itemId });
        purged = gone.length;
      }

      await db.insert(ebaySyncLog).values({
        action: "full-listing-sweep-complete",
        success: true,
        itemCount: cursor.syncedThisSweep,
        details: { totalPages: cursor.totalPages, purgedDeadListings: purged },
        startedAt: new Date(start),
        endedAt: new Date(),
      });
      return {
        ranPages,
        syncedThisRun,
        page: cursor.page,
        totalPages: cursor.totalPages,
        sweepComplete: true,
      };
    }
    cursor.page++;
    await saveCursor(cursor);
  }

  return {
    ranPages,
    syncedThisRun,
    page: cursor.page,
    totalPages: cursor.totalPages,
    sweepComplete: false,
  };
}
