// Construct a public marketplace URL from the externalId Nifty stores
// for each platform. We get the externalId per item from Nifty's React
// state via the Chrome extension; this helper turns it into a clickable
// link.
//
// Patterns vary by platform. Where the format is well-known and the
// externalId is the slug we expect, we construct directly. Where the
// externalId is ambiguous (Nifty sometimes stores a composite like
// "username-itemslug"), we return null and the UI shows the marketplace
// badge without a working link — better than a broken one.

import type { MarketplaceKey } from "@/db/schema";

export type MarketplaceMetadata = {
  externalId: string | null;
  status: string | null; // "LISTED" | "SOLD" | "DELISTED" | etc.
  pictureUrl?: string | null;
  price?: string | number | null;
};

/**
 * Given marketplace + externalId, return a public URL or null.
 *
 * Notes per platform:
 *   eBay      — externalId is the numeric item number. URL: /itm/{id}
 *   Etsy      — externalId is the numeric listing ID. URL: /listing/{id}
 *   Mercari   — externalId is the m-prefixed item id (m12345678). URL: /us/item/{id}/
 *   Poshmark  — externalId is the listing slug (hex string). URL: /listing/{slug}
 *   Depop     — externalId observed to start with the seller username (e.g. "colp...").
 *               URL: /products/{externalId} — works if externalId is the full path.
 *   Whatnot   — auctions/streams, per-item URLs not always stable. We skip for now.
 */
export function buildMarketplaceUrl(
  marketplace: MarketplaceKey,
  externalId: string | null | undefined
): string | null {
  if (!externalId) return null;
  const id = String(externalId).trim();
  if (!id) return null;

  switch (marketplace) {
    case "ebay":
      return `https://www.ebay.com/itm/${encodeURIComponent(id)}`;
    case "etsy":
      return `https://www.etsy.com/listing/${encodeURIComponent(id)}`;
    case "mercari":
      return `https://www.mercari.com/us/item/${encodeURIComponent(id)}/`;
    case "poshmark":
      return `https://poshmark.com/listing/${encodeURIComponent(id)}`;
    case "depop":
      // Depop URLs look like /products/{username}-{itemslug}/ — if Nifty's
      // externalId already encodes that, this works. If not, the link
      // 404s but at least the marketplace badge still tells the visitor
      // it's listed there.
      return `https://www.depop.com/products/${encodeURIComponent(id)}/`;
    case "whatnot":
      // Best-effort: Whatnot's per-product URL appears to follow the
      // pattern /listing/{id}. If that 404s in practice we can update
      // this to a different pattern (e.g. /products/{id}).
      return `https://www.whatnot.com/listing/${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

/**
 * Normalize Nifty's marketplace name (e.g. "eBay", "Poshmark") to our
 * internal lowercase MarketplaceKey ("ebay", "poshmark"). Returns null
 * if it's a name we don't recognize.
 */
export function normalizeMarketplaceName(
  raw: string
): MarketplaceKey | null {
  const lower = raw.toLowerCase().trim();
  const allowed: MarketplaceKey[] = [
    "ebay",
    "etsy",
    "poshmark",
    "mercari",
    "depop",
    "whatnot",
  ];
  if ((allowed as string[]).includes(lower)) {
    return lower as MarketplaceKey;
  }
  return null;
}

/**
 * Find which marketplace converted a sale by scanning the per-platform
 * statuses. The platform with status === "SOLD" wins. If multiple report
 * SOLD (shouldn't happen but in case Nifty is inconsistent), the first
 * one in the platform order is returned.
 */
export function detectSoldMarketplace(
  metadata: Record<string, MarketplaceMetadata>
): MarketplaceKey | null {
  for (const [rawName, meta] of Object.entries(metadata)) {
    if (meta?.status && meta.status.toUpperCase() === "SOLD") {
      return normalizeMarketplaceName(rawName);
    }
  }
  return null;
}

/**
 * Build a map of marketplace → URL from a Nifty marketplaceMetadata
 * payload. Only platforms with an externalId AND a known URL format get
 * a non-null URL entry.
 */
export function buildMarketplaceUrls(
  metadata: Record<string, MarketplaceMetadata>
): Partial<Record<MarketplaceKey, string>> {
  const out: Partial<Record<MarketplaceKey, string>> = {};
  for (const [rawName, meta] of Object.entries(metadata)) {
    const key = normalizeMarketplaceName(rawName);
    if (!key) continue;
    const url = buildMarketplaceUrl(key, meta?.externalId);
    if (url) out[key] = url;
  }
  return out;
}
