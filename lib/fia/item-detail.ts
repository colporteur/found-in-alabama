// FIA product-page data (Phase FIA-SHOP-1) — /item/[itemId] on
// foundinalabama.com. Any in-stock listing in the mirror (FIA shows the
// whole store, not a segment). Adds the FIA price, the weight-based
// single-item shipping estimate, whether it can be bought here, the
// listing description (fetched live once and cached, shared with TES),
// and links to the same item on eBay and the other marketplaces.

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, items } from "@/db/schema";
import { decodeEntities } from "@/lib/ebay/entities";
import {
  OTHER_MARKETPLACES,
  type MarketplaceLink,
} from "@/lib/ebay/storefront";
import { fetchAndCacheDescription } from "@/lib/tes/item-detail";
import {
  fiaItemFacts,
  fiaListingColumns,
  loadFiaPricingContext,
  type FiaItemFacts,
} from "@/lib/fia/catalog";
import {
  singleItemShipping,
  type FiaShipSettings,
  type FiaShippingQuote,
} from "@/lib/fia/shipping";

export type FiaItemDetail = FiaItemFacts & {
  images: string[];
  descriptionHtml: string | null;
  ebayUrl: string;
  /** Same item on Etsy, Poshmark, … (from the Nifty-captured items table). */
  otherMarketplaces: MarketplaceLink[];
  haulSlug: string | null;
  shippingEstimate: FiaShippingQuote;
  settings: FiaShipSettings;
};

async function loadMarketplaceMeta(
  itemId: string
): Promise<{ links: MarketplaceLink[]; haulSlug: string | null }> {
  try {
    const [row] = await db
      .select({ urls: items.marketplaceUrls, haulSlug: items.haulPostSlug })
      .from(items)
      .where(sql`${items.marketplaceUrls}->>'ebay' LIKE ${`%${itemId}%`}`)
      .limit(1);
    if (!row) return { links: [], haulSlug: null };
    const urls = (row.urls as Record<string, string>) ?? {};
    const links: MarketplaceLink[] = [];
    for (const mp of OTHER_MARKETPLACES) {
      if (urls[mp.key]) links.push({ label: mp.label, url: urls[mp.key] });
    }
    return { links, haulSlug: row.haulSlug ?? null };
  } catch {
    return { links: [], haulSlug: null };
  }
}

export async function getFiaItemDetail(
  itemId: string
): Promise<FiaItemDetail | null> {
  if (!/^\d{6,20}$/.test(itemId)) return null;

  const [[row], ctx, meta] = await Promise.all([
    db
      .select({
        ...fiaListingColumns,
        description: ebayListings.description,
        imageUrls: ebayListings.imageUrls,
      })
      .from(ebayListings)
      .where(eq(ebayListings.itemId, itemId))
      .limit(1),
    loadFiaPricingContext(),
    loadMarketplaceMeta(itemId),
  ]);
  if (!row || (row.quantity ?? 0) <= 0) return null;
  const facts = fiaItemFacts(row, ctx);
  if (!facts) return null;

  let description = row.description ?? null;
  let images = Array.isArray(row.imageUrls)
    ? (row.imageUrls as string[])
    : row.imageUrl
      ? [row.imageUrl]
      : [];
  if (!description) {
    const live = await fetchAndCacheDescription(row.itemId);
    description = live.description;
    if (live.imageUrls.length > 0) images = live.imageUrls;
  }
  if (description) description = decodeEntities(description);

  return {
    ...facts,
    images,
    descriptionHtml: description,
    ebayUrl: `https://www.ebay.com/itm/${row.itemId}`,
    otherMarketplaces: meta.links,
    haulSlug: meta.haulSlug,
    shippingEstimate: singleItemShipping(facts.ship, facts.price, ctx.settings),
    settings: ctx.settings,
  };
}
