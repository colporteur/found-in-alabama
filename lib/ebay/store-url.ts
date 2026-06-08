// Helpers for constructing eBay store URLs and parsing eBay item IDs.
//
// Used by Phase 3B "See similar items" to:
//   1. Extract the eBay item ID from a stored marketplaceUrls.ebay value
//      so we can join against the ebayListings cache.
//   2. Build the public store-category URL the "See similar" link points
//      at, given a store category ID.

/** Read the seller username from env. */
function storeUsername(): string | null {
  return process.env.EBAY_STORE_USERNAME?.trim() || null;
}

/**
 * Extract the numeric eBay item ID from a stored URL.
 * Handles both /itm/{id} and /itm/title-suffix/{id} variants.
 */
export function ebayItemIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // /itm/123456789  or /itm/something/123456789
  const m = url.match(/\/itm\/(?:[^/?#]+\/)?(\d{6,})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/**
 * Build a URL that lands on the seller's store filtered to one store
 * category. Returns null if the eBay store username isn't configured
 * (set EBAY_STORE_USERNAME in env vars).
 *
 * The /sch/i.html?_ssn={username}&_storecat={id} pattern is the most
 * reliable filter URL — it works for stores whether or not they've
 * configured a custom URL slug.
 */
export function ebayStoreCategoryUrl(categoryId: string): string | null {
  const seller = storeUsername();
  if (!seller) return null;
  if (!categoryId) return null;
  const params = new URLSearchParams({
    _ssn: seller,
    _storecat: categoryId,
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

/** Returns true when EBAY_STORE_USERNAME is set. */
export function isEbayStoreConfigured(): boolean {
  return !!storeUsername();
}
