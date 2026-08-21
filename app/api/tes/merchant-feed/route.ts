// GET /api/tes/merchant-feed — Google Merchant Center product feed for
// The Ephemeral State. Emits Google Shopping RSS 2.0 (xmlns:g) for every
// in-stock item in the TES segment. Merchant Center fetches this URL on
// a daily schedule, so it's generated fresh from the mirror on demand.
//
// Vintage/one-of-a-kind rules: condition=used, identifier_exists=false
// (no GTIN/MPN/brand exists for a 1948 postcard). Sale pricing rides in
// g:sale_price so Google shows the strike-through. Per-item shipping is
// the first-item rate of the item's ship class — for a single-item order
// that's exactly what the buyer pays; multi-item carts only get cheaper.

import { NextResponse } from "next/server";
import { gt, inArray, and, or } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings } from "@/db/schema";
import { getOnSaleLookup } from "@/lib/ebay/active-sales";
import { decodeEntities } from "@/lib/ebay/entities";
import { loadTesCategories, tesQualifyingSet } from "@/lib/tes/item-detail";
import { plainTextFromHtml } from "@/lib/tes/sanitize";
import {
  SHIP_SCHEDULE,
  maxShipClass,
  normalizeShipClass,
} from "@/lib/tes/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://theephemeralstate.com";
const MAX_ADDITIONAL_IMAGES = 10; // Google's limit per item

/** Escape a string for use inside an XML text node or attribute. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name: string, value: string): string {
  return `<${name}>${esc(value)}</${name}>`;
}

export async function GET() {
  const [cats, onSale] = await Promise.all([
    loadTesCategories(),
    getOnSaleLookup(),
  ]);
  const qualifying = [...tesQualifyingSet(cats)];
  const classByCat = new Map(cats.map((c) => [c.categoryId, c.shipClass]));

  const rows =
    qualifying.length > 0
      ? await db
          .select({
            itemId: ebayListings.itemId,
            title: ebayListings.title,
            price: ebayListings.price,
            description: ebayListings.description,
            primaryImageUrl: ebayListings.primaryImageUrl,
            imageUrls: ebayListings.imageUrls,
            storeCategory1Id: ebayListings.storeCategory1Id,
            storeCategory2Id: ebayListings.storeCategory2Id,
          })
          .from(ebayListings)
          .where(
            and(
              gt(ebayListings.quantity, 0),
              or(
                inArray(ebayListings.storeCategory1Id, qualifying),
                inArray(ebayListings.storeCategory2Id, qualifying)
              )
            )
          )
      : [];

  const items: string[] = [];
  for (const row of rows) {
    const price = row.price != null ? parseFloat(row.price) : NaN;
    if (!Number.isFinite(price) || price <= 0) continue;

    // Google requires an image; skip the (rare) row that has none.
    const gallery = Array.isArray(row.imageUrls)
      ? (row.imageUrls as string[]).filter(
          (u) => typeof u === "string" && u.startsWith("http")
        )
      : [];
    const image = gallery[0] ?? row.primaryImageUrl;
    if (!image) continue;
    const additional = (gallery.length > 0 ? gallery.slice(1) : []).slice(
      0,
      MAX_ADDITIONAL_IMAGES
    );

    // Mirror strings are XML-escaped at capture time (entity processing is
    // off in the Trading parser) — decode to real text, then esc() re-escapes
    // exactly once for this document.
    const title = decodeEntities(row.title).trim().slice(0, 150);
    const description = row.description
      ? plainTextFromHtml(decodeEntities(row.description), 4900)
      : title;

    // Sale-aware pricing: g:price is the regular price; g:sale_price makes
    // Google render the discount.
    const badge =
      onSale.byListingId.get(row.itemId) ??
      (row.storeCategory1Id
        ? onSale.byCategoryId.get(row.storeCategory1Id)
        : undefined) ??
      (row.storeCategory2Id
        ? onSale.byCategoryId.get(row.storeCategory2Id)
        : undefined) ??
      null;
    const salePrice = badge
      ? Math.round(price * (1 - badge.discountPercent / 100) * 100) / 100
      : null;

    const shipClass = maxShipClass(
      normalizeShipClass(
        row.storeCategory1Id
          ? classByCat.get(row.storeCategory1Id)
          : undefined
      ),
      normalizeShipClass(
        row.storeCategory2Id
          ? classByCat.get(row.storeCategory2Id)
          : undefined
      )
    );
    const shipPrice = SHIP_SCHEDULE[shipClass].first;

    items.push(
      [
        `<item>`,
        tag("g:id", row.itemId),
        tag("g:title", title),
        tag("g:description", description || title),
        tag("g:link", `${BASE}/item/${row.itemId}`),
        tag("g:image_link", image),
        ...additional.map((u) => tag("g:additional_image_link", u)),
        tag("g:price", `${price.toFixed(2)} USD`),
        ...(salePrice != null && salePrice < price
          ? [tag("g:sale_price", `${salePrice.toFixed(2)} USD`)]
          : []),
        tag("g:availability", "in_stock"),
        tag("g:condition", "used"),
        tag("g:identifier_exists", "false"),
        `<g:shipping>`,
        tag("g:country", "US"),
        tag("g:service", "Standard"),
        tag("g:price", `${shipPrice.toFixed(2)} USD`),
        `</g:shipping>`,
        `</item>`,
      ].join("")
    );
  }

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">`,
    `<channel>`,
    tag("title", "The Ephemeral State"),
    tag("link", BASE),
    tag(
      "description",
      "Vintage ephemera, postcards, photographs, and paper collectibles from every state."
    ),
    ...items,
    `</channel>`,
    `</rss>`,
    ``,
  ].join("\n");

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
