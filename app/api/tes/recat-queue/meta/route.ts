// GET /api/tes/recat-queue/meta?itemId=... — everything the storefront
// overlay needs to build its recategorize popover for one item:
//   - the item's current two Store Category slots (id + full path)
//   - the assignable (leaf) category list for the manual picker
//   - whether a pending queue row already exists for the item
// Auth: Bearer <api key> (same keys as /admin/api-keys). The overlay
// content script can't call cross-origin itself, so the extension's
// background worker proxies these requests.

import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, ebayStoreCategories, tesRecatQueue } from "@/db/schema";
import { bearerFromRequest, verifyApiKey } from "@/lib/api-keys";
import { buildCategoryTree } from "@/lib/ebay/category-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = bearerFromRequest(req);
  const key = token ? await verifyApiKey(token) : null;
  if (!key) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const itemId = req.nextUrl.searchParams.get("itemId")?.trim();
  if (!itemId) {
    return NextResponse.json({ ok: false, error: "itemId required" }, { status: 400 });
  }

  const [listing] = await db
    .select()
    .from(ebayListings)
    .where(eq(ebayListings.itemId, itemId))
    .limit(1);
  if (!listing) {
    return NextResponse.json(
      { ok: false, error: "Listing not in local mirror — run a listings sync" },
      { status: 404 }
    );
  }

  const rows = await db.select().from(ebayStoreCategories);
  const tree = buildCategoryTree(rows);
  const pathById = new Map(tree.map((n) => [n.categoryId, n.path]));

  const slot = (id: string | null) =>
    id ? { categoryId: id, path: pathById.get(id) ?? `(unknown ${id})` } : null;

  const pending = await db
    .select({ id: tesRecatQueue.id })
    .from(tesRecatQueue)
    .where(and(eq(tesRecatQueue.itemId, itemId), eq(tesRecatQueue.status, "pending")))
    .limit(1);

  return NextResponse.json({
    ok: true,
    item: {
      itemId: listing.itemId,
      title: listing.title,
      sku: listing.sku,
      slot1: slot(listing.storeCategory1Id),
      slot2: slot(listing.storeCategory2Id),
    },
    // Manual-picker options: leaves only (eBay refuses items in parents).
    categories: tree
      .filter((n) => n.isLeaf)
      .map((n) => ({ id: n.categoryId, path: n.path })),
    alreadyQueued: pending.length > 0,
  });
}
