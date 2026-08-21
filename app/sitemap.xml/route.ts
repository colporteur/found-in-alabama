// GET /sitemap.xml — host-aware. TES hosts get the Ephemeral State pages
// (home + flagged category grids, clean URLs); FIA hosts get the public
// FIA pages + shop categories. Category lists come from the same
// storefront segment logic the pages use, so the sitemap can't drift
// from what actually renders.

import { NextRequest, NextResponse } from "next/server";
import { gt, inArray, and, or } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings } from "@/db/schema";
import { isTesHostName } from "@/lib/tes/host";
import { getStorefrontCategories } from "@/lib/ebay/storefront";
import { loadTesCategories, tesQualifyingSet } from "@/lib/tes/item-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function urlTag(loc: string, changefreq: string, priority: string): string {
  return `  <url><loc>${loc}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

export async function GET(req: NextRequest) {
  const tes = isTesHostName(req.headers.get("host"));
  const entries: string[] = [];

  if (tes) {
    const base = "https://theephemeralstate.com";
    entries.push(urlTag(`${base}/`, "hourly", "1.0"));
    entries.push(urlTag(`${base}/states`, "daily", "0.9"));
    entries.push(urlTag(`${base}/types`, "daily", "0.9"));
    entries.push(urlTag(`${base}/returns`, "monthly", "0.3"));
    const cats = await getStorefrontCategories({ segment: "tes" });
    for (const c of cats) {
      entries.push(urlTag(`${base}/shop/${c.slug}`, "hourly", "0.8"));
    }
    // Product pages — every in-stock item in the TES segment.
    const allCats = await loadTesCategories();
    const qualifying = [...tesQualifyingSet(allCats)];
    if (qualifying.length > 0) {
      const items = await db
        .select({ itemId: ebayListings.itemId })
        .from(ebayListings)
        .where(
          and(
            gt(ebayListings.quantity, 0),
            or(
              inArray(ebayListings.storeCategory1Id, qualifying),
              inArray(ebayListings.storeCategory2Id, qualifying)
            )
          )
        );
      for (const it of items) {
        entries.push(urlTag(`${base}/item/${it.itemId}`, "daily", "0.6"));
      }
    }
  } else {
    const base = "https://www.foundinalabama.com";
    entries.push(urlTag(`${base}/`, "daily", "1.0"));
    entries.push(urlTag(`${base}/shop`, "hourly", "0.9"));
    const cats = await getStorefrontCategories();
    for (const c of cats) {
      entries.push(urlTag(`${base}/shop/${c.slug}`, "hourly", "0.8"));
    }
    for (const p of ["journal", "about", "we-buy", "find-me", "contact"]) {
      entries.push(urlTag(`${base}/${p}`, "weekly", "0.5"));
    }
  }

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...entries,
    `</urlset>`,
    ``,
  ].join("\n");

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
