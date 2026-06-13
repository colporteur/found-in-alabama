// Public storefront data — a browse-by-category view over the local
// ebay_listings mirror (synced from the eBay store). Powers /shop and
// /shop/[category].
//
// Categories come from ebay_store_categories; item membership and counts
// come from ebay_listings (a listing belongs to a category if either of
// its two store-category slots matches). The "Other" bucket — items the
// categorizer hasn't sorted yet — is surfaced as "New Arrivals" (they
// genuinely are the newest, uncategorized stock).
//
// Every "Buy" link points at the real eBay listing; this is a discovery
// layer, not a checkout. On-sale badges reuse lib/ebay/active-sales.

import { and, desc, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, ebayStoreCategories, items } from "@/db/schema";
import { getOnSaleLookup, type SaleBadge } from "@/lib/ebay/active-sales";
import { ebayItemIdFromUrl } from "@/lib/ebay/store-url";

/** Other marketplaces we cross-link to (eBay is the card's main link). */
const OTHER_MARKETPLACES: { key: string; label: string }[] = [
  { key: "etsy", label: "Etsy" },
  { key: "poshmark", label: "Poshmark" },
  { key: "mercari", label: "Mercari" },
  { key: "depop", label: "Depop" },
  { key: "whatnot", label: "Whatnot" },
];

export type MarketplaceLink = { label: string; url: string };

export const NEW_ARRIVALS_SLUG = "new-arrivals";
export const NEW_ARRIVALS_NAME = "New Arrivals";

export type StorefrontCategory = {
  categoryId: string;
  name: string;
  slug: string;
  count: number;
  isNewArrivals: boolean;
  parentCategoryId: string | null;
  /** In-stock items in this category currently on sale. */
  onSaleCount: number;
  /** True when an active sale covers the whole category. */
  wholeCategoryOnSale: boolean;
  /** Representative thumbnail (newest in-stock item in the category). */
  imageUrl: string | null;
};

/** A top-level category plus any child categories nested under it. */
export type StorefrontCategoryGroup = StorefrontCategory & {
  children: StorefrontCategory[];
};

/**
 * Decode the HTML entities eBay's XML leaves in category names
 * (e.g. "Books &amp; Ephemera" → "Books & Ephemera") so they render
 * as real characters.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** URL-safe slug from a category name. */
export function slugifyCategory(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** In-stock listings only (quantity > 0). */
function inStock() {
  return gt(ebayListings.quantity, 0);
}

/**
 * All categories that currently have at least one in-stock listing,
 * with counts. New Arrivals (the Other bucket) is always last.
 */
export async function getStorefrontCategories(): Promise<StorefrontCategory[]> {
  const [cats, listingCats, onSale] = await Promise.all([
    db
      .select({
        categoryId: ebayStoreCategories.categoryId,
        name: ebayStoreCategories.name,
        order: ebayStoreCategories.order,
        parentCategoryId: ebayStoreCategories.parentCategoryId,
        isOtherBucket: ebayStoreCategories.isOtherBucket,
      })
      .from(ebayStoreCategories),
    db
      .select({
        itemId: ebayListings.itemId,
        cat1: ebayListings.storeCategory1Id,
        cat2: ebayListings.storeCategory2Id,
        imageUrl: ebayListings.primaryImageUrl,
        startTime: ebayListings.startTime,
      })
      .from(ebayListings)
      .where(inStock()),
    getOnSaleLookup(),
  ]);

  // Per category: count, on-sale count, and a representative image
  // (newest in-stock item that has a photo).
  const countById = new Map<string, number>();
  const onSaleCountById = new Map<string, number>();
  const repImageById = new Map<string, { t: number; url: string }>();
  for (const l of listingCats) {
    const seen = new Set<string>();
    if (l.cat1) seen.add(l.cat1);
    if (l.cat2) seen.add(l.cat2);
    const itemOnSaleByListing = onSale.byListingId.has(l.itemId);
    const t = l.startTime ? new Date(l.startTime).getTime() : 0;
    for (const c of seen) {
      countById.set(c, (countById.get(c) ?? 0) + 1);
      if (itemOnSaleByListing || onSale.byCategoryId.has(c)) {
        onSaleCountById.set(c, (onSaleCountById.get(c) ?? 0) + 1);
      }
      if (l.imageUrl) {
        const cur = repImageById.get(c);
        if (!cur || t > cur.t) repImageById.set(c, { t, url: l.imageUrl });
      }
    }
  }
  const otherId = cats.find((c) => c.isOtherBucket)?.categoryId ?? null;

  // Slug uniqueness: append the id if two categories slugify the same.
  const slugSeen = new Map<string, number>();
  const result: StorefrontCategory[] = [];
  for (const cat of cats) {
    const isNewArrivals = cat.isOtherBucket;
    const count = countById.get(cat.categoryId) ?? 0;
    if (count === 0) continue; // hide empty categories
    const displayName = isNewArrivals
      ? NEW_ARRIVALS_NAME
      : decodeEntities(cat.name);
    // The Other bucket owns the "New Arrivals" name — never show a second
    // real category by that name (e.g. a stale, since-deleted eBay one).
    if (!isNewArrivals && displayName === NEW_ARRIVALS_NAME) continue;
    let slug = isNewArrivals ? NEW_ARRIVALS_SLUG : slugifyCategory(displayName);
    const seen = slugSeen.get(slug) ?? 0;
    slugSeen.set(slug, seen + 1);
    if (seen > 0 && !isNewArrivals) slug = `${slug}-${cat.categoryId}`;
    result.push({
      categoryId: cat.categoryId,
      name: displayName,
      slug,
      count,
      isNewArrivals,
      parentCategoryId: cat.parentCategoryId,
      onSaleCount: onSaleCountById.get(cat.categoryId) ?? 0,
      wholeCategoryOnSale: onSale.byCategoryId.has(cat.categoryId),
      imageUrl: repImageById.get(cat.categoryId)?.url ?? null,
    });
  }

  // Named categories alphabetical; New Arrivals pinned last.
  result.sort((a, b) => {
    if (a.isNewArrivals) return 1;
    if (b.isNewArrivals) return -1;
    return a.name.localeCompare(b.name);
  });
  // Defensive: if the Other bucket exists but somehow wasn't counted by
  // category slot, surface it anyway when it has stock.
  if (otherId && !result.some((r) => r.isNewArrivals)) {
    const n = countById.get(otherId) ?? 0;
    if (n > 0) {
      result.push({
        categoryId: otherId,
        name: NEW_ARRIVALS_NAME,
        slug: NEW_ARRIVALS_SLUG,
        count: n,
        isNewArrivals: true,
        parentCategoryId: null,
        onSaleCount: onSaleCountById.get(otherId) ?? 0,
        wholeCategoryOnSale: onSale.byCategoryId.has(otherId),
        imageUrl: repImageById.get(otherId)?.url ?? null,
      });
    }
  }
  return result;
}

/**
 * Categories nested into top-level groups with their children. A parent
 * with no direct stock still appears if any child has stock. New
 * Arrivals is pinned last.
 */
export async function getStorefrontCategoryTree(): Promise<
  StorefrontCategoryGroup[]
> {
  const flat = await getStorefrontCategories();
  const byId = new Map(flat.map((c) => [c.categoryId, c]));
  const childrenByParent = new Map<string, StorefrontCategory[]>();
  const topLevel: StorefrontCategory[] = [];

  for (const cat of flat) {
    const parentExists =
      cat.parentCategoryId != null && byId.has(cat.parentCategoryId);
    if (parentExists) {
      const arr = childrenByParent.get(cat.parentCategoryId!) ?? [];
      arr.push(cat);
      childrenByParent.set(cat.parentCategoryId!, arr);
    } else {
      topLevel.push(cat);
    }
  }

  const groups: StorefrontCategoryGroup[] = topLevel.map((cat) => {
    const children = (childrenByParent.get(cat.categoryId) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    // A parent with no direct photo borrows its first child's.
    const imageUrl =
      cat.imageUrl ?? children.find((c) => c.imageUrl)?.imageUrl ?? null;
    return { ...cat, imageUrl, children };
  });
  groups.sort((a, b) => {
    if (a.isNewArrivals) return 1;
    if (b.isNewArrivals) return -1;
    return a.name.localeCompare(b.name);
  });
  return groups;
}

/** Resolve a URL slug to its category, or null. */
export async function resolveCategorySlug(
  slug: string
): Promise<StorefrontCategory | null> {
  const cats = await getStorefrontCategories();
  return cats.find((c) => c.slug === slug) ?? null;
}

export type StorefrontItem = {
  itemId: string;
  title: string;
  price: string | null;
  imageUrl: string | null;
  ebayUrl: string;
  sale: SaleBadge | null;
  /** Journal post slug when this item came from a documented haul. */
  haulSlug: string | null;
  /** Links to the same item on other marketplaces (Etsy, Poshmark, …). */
  marketplaceLinks: MarketplaceLink[];
};

type ItemMeta = { haulSlug: string | null; marketplaceLinks: MarketplaceLink[] };

/**
 * Map of eBay listing id → { haulSlug, other-marketplace links }, built
 * from the items table (captured by the Nifty extension). Lets the
 * storefront link a listing back to its haul story AND show where else
 * the same item is for sale. Keyed by the eBay item id parsed from each
 * item's marketplaceUrls.ebay.
 *
 * Filtered in SQL to only items that actually carry a haul link or a
 * non-eBay marketplace, so we don't load the whole table.
 */
async function getItemMetaByEbayId(): Promise<Map<string, ItemMeta>> {
  const rows = await db
    .select({
      marketplaceUrls: items.marketplaceUrls,
      haulPostSlug: items.haulPostSlug,
    })
    .from(items)
    .where(
      or(
        isNotNull(items.haulPostSlug),
        sql`jsonb_exists_any(${items.marketplaceUrls}, array['etsy','poshmark','mercari','depop','whatnot'])`
      )
    );
  const map = new Map<string, ItemMeta>();
  for (const r of rows) {
    const urls = (r.marketplaceUrls as Record<string, string>) ?? {};
    const ebayId = ebayItemIdFromUrl(urls.ebay);
    if (!ebayId) continue;
    const links: MarketplaceLink[] = [];
    for (const mp of OTHER_MARKETPLACES) {
      const url = urls[mp.key];
      if (url) links.push({ label: mp.label, url });
    }
    map.set(ebayId, {
      haulSlug: r.haulPostSlug ?? null,
      marketplaceLinks: links,
    });
  }
  return map;
}

/** Listings in one category, newest first, with on-sale badges. */
export async function getCategoryItems(
  category: StorefrontCategory,
  limit = 240
): Promise<StorefrontItem[]> {
  const rows = await db
    .select({
      itemId: ebayListings.itemId,
      title: ebayListings.title,
      price: ebayListings.price,
      imageUrl: ebayListings.primaryImageUrl,
      cat1: ebayListings.storeCategory1Id,
      cat2: ebayListings.storeCategory2Id,
    })
    .from(ebayListings)
    .where(
      and(
        inStock(),
        or(
          eq(ebayListings.storeCategory1Id, category.categoryId),
          eq(ebayListings.storeCategory2Id, category.categoryId)
        )
      )
    )
    .orderBy(desc(ebayListings.startTime))
    .limit(limit);

  const [onSale, metaByEbayId] = await Promise.all([
    getOnSaleLookup(),
    getItemMetaByEbayId(),
  ]);
  return rows.map((r) => {
    const sale =
      onSale.byListingId.get(r.itemId) ??
      onSale.byCategoryId.get(category.categoryId) ??
      null;
    const meta = metaByEbayId.get(r.itemId);
    return {
      itemId: r.itemId,
      title: r.title,
      price: r.price,
      imageUrl: r.imageUrl,
      ebayUrl: `https://www.ebay.com/itm/${r.itemId}`,
      sale,
      haulSlug: meta?.haulSlug ?? null,
      marketplaceLinks: meta?.marketplaceLinks ?? [],
    };
  });
}
