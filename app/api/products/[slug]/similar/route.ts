// GET /api/products/[slug]/similar
//
// Returns { url } pointing at the eBay store category page for the most
// likely "similar items" category, falling back to a one-shot Haiku call
// when neither the cache nor the eBay listing join can answer.
//
// Public endpoint — no auth. The product page is already public, this
// just expands a link on it.

import { NextRequest, NextResponse } from "next/server";
import { db, items } from "@/db";
import { eq } from "drizzle-orm";
import { resolveSimilarCategoryId } from "@/lib/items/similar";
import {
  ebayStoreCategoryUrl,
  isEbayStoreConfigured,
} from "@/lib/ebay/store-url";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } }
) {
  if (!params.slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }
  if (!isEbayStoreConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set EBAY_STORE_USERNAME in Vercel env vars so we can build store URLs.",
      },
      { status: 503 }
    );
  }
  // Try by slug, then by id — both URL shapes are valid until every row
  // has its slug backfilled by the next Chrome-extension sync.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let [item] = await db
    .select()
    .from(items)
    .where(eq(items.slug, params.slug))
    .limit(1);
  if (!item && UUID_RE.test(params.slug)) {
    [item] = await db
      .select()
      .from(items)
      .where(eq(items.id, params.slug))
      .limit(1);
  }
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  const categoryId = await resolveSimilarCategoryId(item);
  if (!categoryId) {
    return NextResponse.json(
      { error: "Could not resolve a category for this item." },
      { status: 404 }
    );
  }
  const url = ebayStoreCategoryUrl(categoryId);
  if (!url) {
    return NextResponse.json(
      { error: "eBay store URL builder returned null." },
      { status: 500 }
    );
  }
  return NextResponse.json({ url, categoryId });
}
