// GET /api/fia/merchant-feed — Google Merchant Center product feed for
// Found in Alabama (foundinalabama.com). Same RSS 2.0 (xmlns:g) format as
// /api/tes/merchant-feed.
//
// Which items: every in-stock listing that can be bought here
// (fiaItemFacts().directSale — not over the weight/size cap), EXCEPT items
// in The Ephemeral State's segment. Those go in the TES feed only, so the
// same piece isn't submitted by two Merchant Center accounts (Google treats
// that as duplicate/misrepresented offers).
//
// Prices: g:price is what this site charges (fiaItemFacts().price, the
// discount already applied) — the same number as the product page, its
// JSON-LD, and checkout. No g:sale_price; see the TES feed for why.
//
// Shipping: the one-item quote from lib/fia/shipping, exactly what a buyer
// of just that item pays.

import { NextResponse } from "next/server";
import { FEED_DESCRIPTION_CHARS, feedPart, inPart } from "@/lib/merchant-feed";
import { asc, gt } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings } from "@/db/schema";
import { decodeEntities } from "@/lib/ebay/entities";
import { plainTextFromHtml } from "@/lib/tes/sanitize";
import { loadTesCategories, tesQualifyingSet } from "@/lib/tes/item-detail";
import {
  fiaItemFacts,
  fiaListingColumns,
  loadFiaPricingContext,
} from "@/lib/fia/catalog";
import { singleItemShipping } from "@/lib/fia/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://www.foundinalabama.com";
const MAX_ADDITIONAL_IMAGES = 10;

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

export async function GET(req: Request) {
  const part = feedPart(req.url);
  const [ctx, tesCats] = await Promise.all([
    loadFiaPricingContext(),
    loadTesCategories(),
  ]);
  const tesSet = tesQualifyingSet(tesCats);

  const rows = await db
    .select({
      ...fiaListingColumns,
      description: ebayListings.description,
      imageUrls: ebayListings.imageUrls,
    })
    .from(ebayListings)
    .where(gt(ebayListings.quantity, 0))
    .orderBy(asc(ebayListings.itemId));

  const items: string[] = [];
  for (const row of inPart(rows, part)) {
    if (
      (row.cat1 && tesSet.has(row.cat1)) ||
      (row.cat2 && tesSet.has(row.cat2))
    ) {
      continue; // TES feed's item
    }
    const facts = fiaItemFacts(row, ctx);
    if (!facts || !facts.directSale || facts.price <= 0) continue;

    const gallery = Array.isArray(row.imageUrls)
      ? (row.imageUrls as string[]).filter(
          (u) => typeof u === "string" && u.startsWith("http")
        )
      : [];
    const image = gallery[0] ?? row.imageUrl;
    if (!image) continue;
    const additional = gallery.slice(1, 1 + MAX_ADDITIONAL_IMAGES);

    const ship = singleItemShipping(facts.ship, facts.price, ctx.settings);
    if (!ship.ok) continue; // can't be quoted → can't be bought here

    const title = facts.title.trim().slice(0, 150);
    const description = row.description
      ? plainTextFromHtml(decodeEntities(row.description), FEED_DESCRIPTION_CHARS)
      : title;

    items.push(
      [
        `<item>`,
        tag("g:id", `FIA-${facts.itemId}`),
        tag("g:title", title),
        tag("g:description", description || title),
        tag("g:link", `${BASE}/item/${facts.itemId}`),
        tag("g:image_link", image),
        ...additional.map((u) => tag("g:additional_image_link", u)),
        tag("g:price", `${facts.price.toFixed(2)} USD`),
        tag("g:availability", "in_stock"),
        tag("g:condition", "used"),
        tag("g:identifier_exists", "false"),
        `<g:shipping>`,
        tag("g:country", "US"),
        tag("g:service", "Standard"),
        tag("g:price", `${ship.shipping.toFixed(2)} USD`),
        `</g:shipping>`,
        `</item>`,
      ].join("")
    );
  }

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">`,
    `<channel>`,
    tag("title", "Found in Alabama"),
    tag("link", BASE),
    tag(
      "description",
      "Estate finds, vintage, books, ephemera, and small antiques, shipped from Lineville, Alabama."
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
