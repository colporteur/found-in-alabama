// Typed wrappers around the Trading API calls we use. Each function does the
// minimum parsing needed to return clean shapes the rest of the app can lean
// on without thinking in XML.

import { tradingCall } from "./client";

// ─── GetStore: pull the seller's Store custom-category tree ───────────────────

export interface StoreCategoryNode {
  categoryId: string;
  name: string;
  order: number;
  parentId: string | null;
  children: StoreCategoryNode[];
}

export async function fetchStoreCategoryTree(): Promise<StoreCategoryNode[]> {
  // Call GetStore with the smallest possible body. Earlier we passed
  // LevelLimit + CategoryStructureOnly; eBay's schema validation rejected
  // those values ("Input data for tag <5> is invalid"). The default response
  // already includes the full CustomCategory tree, so we don't need them.
  const res = await tradingCall("GetStore", {
    CategoryStructureOnly: "true",
  });
  const store = (res as { Store?: { CustomCategories?: { CustomCategory?: unknown } } })
    .Store;
  const raw = store?.CustomCategories?.CustomCategory;
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((c) => normalizeCategoryNode(c, null));
}

/**
 * Flatten a nested tree into a list of {categoryId, parentId, name, order,
 * depth} so it's easy to insert into the database in one bulk upsert.
 */
export function flattenCategoryTree(
  nodes: StoreCategoryNode[]
): Array<{
  categoryId: string;
  parentCategoryId: string | null;
  name: string;
  order: number;
  depth: number;
}> {
  const out: Array<{
    categoryId: string;
    parentCategoryId: string | null;
    name: string;
    order: number;
    depth: number;
  }> = [];
  const walk = (node: StoreCategoryNode, depth: number) => {
    out.push({
      categoryId: node.categoryId,
      parentCategoryId: node.parentId,
      name: node.name,
      order: node.order,
      depth,
    });
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const node of nodes) walk(node, 0);
  return out;
}

function normalizeCategoryNode(c: unknown, parentId: string | null): StoreCategoryNode {
  const obj = c as Record<string, unknown>;
  const id = String(obj.CategoryID ?? "");
  const node: StoreCategoryNode = {
    categoryId: id,
    name: String(obj.Name ?? ""),
    order: Number(obj.Order ?? 0),
    parentId,
    children: [],
  };
  const child = obj.ChildCategory;
  if (child) {
    const childArr = Array.isArray(child) ? child : [child];
    node.children = childArr.map((c2) => normalizeCategoryNode(c2, id));
  }
  return node;
}

// ─── GetSellerList: paginated active listings ────────────────────────────────

export interface FetchedListing {
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

export interface FetchListingsOptions {
  /**
   * If true, only emit listings whose StoreCategoryID matches `otherCategoryId`
   * AND whose StoreCategory2ID is empty. Filtering happens client-side because
   * GetSellerList doesn't accept a store-category filter directly.
   */
  filterToOtherWithNoSecond?: { otherCategoryId: string };
  /**
   * Window of "ending within the next N days" — eBay requires an EndTime
   * range. Active fixed-price listings auto-renew, so 120 covers everything.
   */
  endingWithinDays?: number;
  entriesPerPage?: number;
  /** Optional cap on total items emitted (useful during dev). */
  maxItems?: number;
}

/**
 * Async iterator that yields one page of listings at a time. The caller can
 * persist incrementally and stop early when desired.
 */
export async function* iterateActiveListings(
  opts: FetchListingsOptions = {}
): AsyncGenerator<FetchedListing[]> {
  const { filterToOtherWithNoSecond, endingWithinDays = 120, entriesPerPage = 200, maxItems } = opts;

  const now = new Date();
  const future = new Date(now.getTime() + endingWithinDays * 24 * 60 * 60 * 1000);

  let pageNumber = 1;
  let emitted = 0;

  while (true) {
    const res = await tradingCall("GetSellerList", {
      EndTimeFrom: now.toISOString(),
      EndTimeTo: future.toISOString(),
      DetailLevel: "ReturnAll",
      GranularityLevel: "Coarse",
      Pagination: { EntriesPerPage: entriesPerPage, PageNumber: pageNumber },
    });

    const itemArray = (res as { ItemArray?: { Item?: unknown } }).ItemArray;
    const rawItems = itemArray?.Item;
    const arr = !rawItems ? [] : Array.isArray(rawItems) ? rawItems : [rawItems];

    let page = arr.map(toFetchedListing);
    if (filterToOtherWithNoSecond) {
      page = page.filter(
        (l) =>
          l.storeCategory1Id === filterToOtherWithNoSecond.otherCategoryId &&
          !l.storeCategory2Id
      );
    }

    if (maxItems !== undefined) {
      const remaining = maxItems - emitted;
      if (remaining <= 0) return;
      if (page.length > remaining) page = page.slice(0, remaining);
    }

    if (page.length) {
      yield page;
      emitted += page.length;
    }

    const totalPages = Number(
      (res as { PaginationResult?: { TotalNumberOfPages?: unknown } })
        .PaginationResult?.TotalNumberOfPages ?? 1
    );
    if (pageNumber >= totalPages) return;
    pageNumber++;
  }
}

function toFetchedListing(item: unknown): FetchedListing {
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
    storeCategory1Id:
      storefront.StoreCategoryID != null
        ? String(storefront.StoreCategoryID)
        : null,
    storeCategory2Id:
      storefront.StoreCategory2ID != null
        ? String(storefront.StoreCategory2ID)
        : null,
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

// ─── ReviseItem: update a listing's two store-category slots ─────────────────

/**
 * Update the Store Category 1 (and optionally 2) on a single listing.
 * Pass `null` for storeCategory2Id to leave slot 2 unchanged. Pass an empty
 * string to clear it (eBay accepts an empty value to remove slot 2).
 */
export async function reviseStoreCategories(
  itemId: string,
  storeCategory1Id: string,
  storeCategory2Id: string | null = null
): Promise<void> {
  const storefront: Record<string, string> = {
    StoreCategoryID: storeCategory1Id,
  };
  if (storeCategory2Id !== null) {
    storefront.StoreCategory2ID = storeCategory2Id;
  }
  await tradingCall("ReviseItem", {
    Item: {
      ItemID: itemId,
      Storefront: storefront,
    },
  });
}

// ─── GetItem: fetch full description text for a single item ──────────────────

export async function fetchItemDescription(itemId: string): Promise<string | null> {
  const res = await tradingCall("GetItem", {
    ItemID: itemId,
    DetailLevel: "ReturnAll",
    IncludeItemSpecifics: false,
  });
  const item = (res as { Item?: Record<string, unknown> }).Item;
  if (!item) return null;
  const desc = item.Description;
  return desc != null ? String(desc) : null;
}
