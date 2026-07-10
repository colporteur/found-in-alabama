// Resolves the "See similar items" eBay store category for one item.
//
// Three-tier resolution:
//   1. Cached items.ebayStoreCategoryId (instant, free, repeatable).
//   2. Join to ebayListings via the eBay item ID extracted from
//      marketplaceUrls.ebay (instant, free, only works if the auto-
//      categorizer already categorized this listing on eBay).
//   3. One-shot Haiku call asking Claude to pick the best store category
//      from the item title. Cached on items.ebayStoreCategoryId so
//      future visits skip the call.
//
// `resolveSimilarCategoryId(item)` runs all three in order and persists
// the result. Designed to be safe to call on every product-page render —
// the cache means we only pay for Claude once per item.

import { db, items, ebayListings, ebayStoreCategories } from "@/db";
import { eq } from "drizzle-orm";
import { gatewayMessages } from "@/lib/gateway";
import { ebayItemIdFromUrl } from "@/lib/ebay/store-url";
import type { MarketplaceKey } from "@/db/schema";

type ItemRow = typeof items.$inferSelect;

// Gateway alias — actual model set in the gateway routing table
// (Admin → AI Models). Seeded to anthropic/claude-haiku-4.5.
const HAIKU_MODEL = "fia-cheap";

/**
 * Fast resolution — tries only the cache and the eBay-listing join.
 * Safe to call on every page render because both are local SELECTs.
 * Returns null when no fast resolution is possible (caller can offer a
 * "Find similar" button that hits the slow path).
 */
export async function resolveSimilarCategoryIdFast(
  item: ItemRow
): Promise<string | null> {
  // 1. Cached value wins.
  if (item.ebayStoreCategoryId) return item.ebayStoreCategoryId;

  // 2. Try to join via the eBay item ID from the stored marketplace URL.
  const marketplaceUrls = (item.marketplaceUrls as Partial<
    Record<MarketplaceKey, string>
  > | null) ?? {};
  const ebayItemId = ebayItemIdFromUrl(marketplaceUrls.ebay ?? null);
  if (ebayItemId) {
    const [row] = await db
      .select({ cat1: ebayListings.storeCategory1Id })
      .from(ebayListings)
      .where(eq(ebayListings.itemId, ebayItemId))
      .limit(1);
    if (row?.cat1) {
      // Cache it on the item and return.
      await persistCategory(item.id, row.cat1);
      return row.cat1;
    }
  }
  return null;
}

/**
 * Full resolution — runs the fast path, then falls back to a Haiku
 * call if needed. Persists whatever it picks. Use this from the API
 * route that the client button hits, NOT from page render (to keep
 * page loads fast).
 */
export async function resolveSimilarCategoryId(
  item: ItemRow
): Promise<string | null> {
  const fast = await resolveSimilarCategoryIdFast(item);
  if (fast) return fast;

  const claudePick = await pickCategoryWithClaude(item.title);
  if (claudePick) {
    await persistCategory(item.id, claudePick);
    return claudePick;
  }
  return null;
}

async function persistCategory(itemId: string, categoryId: string): Promise<void> {
  await db
    .update(items)
    .set({
      ebayStoreCategoryId: categoryId,
      updatedAt: new Date(),
    })
    .where(eq(items.id, itemId));
}

/**
 * Ask Claude (Haiku) to pick the best store category for an item by
 * title alone. Returns the category ID string or null if Claude couldn't
 * pick one. Roughly $0.0003 per call.
 */
async function pickCategoryWithClaude(title: string): Promise<string | null> {
  // Load the live category list. Filter out the "Other" bucket — we
  // don't want to recommend "Other" to a buyer browsing for similar.
  const categoryRows = await db
    .select({
      categoryId: ebayStoreCategories.categoryId,
      name: ebayStoreCategories.name,
      isOtherBucket: ebayStoreCategories.isOtherBucket,
    })
    .from(ebayStoreCategories);
  const usable = categoryRows.filter((r) => !r.isOtherBucket);
  if (usable.length === 0) return null;

  const list = usable
    .map((c) => `${c.categoryId}\t${c.name}`)
    .join("\n");

  let resp;
  try {
    resp = await gatewayMessages({
      model: HAIKU_MODEL,
      max_tokens: 80,
      system:
        "You match a product to the single best matching eBay store category from a provided list. Output ONLY the category ID — the numeric/string identifier on the left side of the tab. No prose, no explanation, no quotes.",
      messages: [
        {
          role: "user",
          content: `Categories (format: id<TAB>name):
${list}

Product title:
${title}

Output the best-matching category id, nothing else.`,
        },
      ],
    });
  } catch (err) {
    console.error("[similar] Claude call failed", err);
    return null;
  }

  const text = resp.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  const picked = text.text.trim().split(/\s+/)[0]; // first token only

  // Validate that Claude returned a real category id from our list.
  if (!usable.some((c) => c.categoryId === picked)) {
    console.warn(
      `[similar] Claude picked unknown category "${picked}" for title "${title}"`
    );
    return null;
  }
  return picked;
}
