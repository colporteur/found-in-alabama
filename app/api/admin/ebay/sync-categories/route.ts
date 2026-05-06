// POST /api/admin/ebay/sync-categories
// Pulls the seller's eBay Store custom-category tree via GetStore, auto-flags
// Alabama-related and "Other" categories on first insert, and upserts each
// row into ebay_store_categories. Subsequent syncs only refresh structural
// fields (name, parentCategoryId, order, lastSyncedAt) — they preserve any
// manual edits you've made to isAlabamaRelated / isOtherBucket.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { ebayStoreCategories, ebaySyncLog } from "@/db/schema";
import { fetchStoreCategoryTree, flattenCategoryTree } from "@/lib/ebay/calls";
import { scoreAlabama } from "@/lib/ebay/alabama";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  try {
    const tree = await fetchStoreCategoryTree();
    const flat = flattenCategoryTree(tree);

    if (flat.length === 0) {
      return NextResponse.json(
        { ok: false, error: "GetStore returned an empty category list" },
        { status: 502 }
      );
    }

    // Detect the "Other" bucket by name. Most stores have exactly one category
    // literally named "Other"; we mark it so the listings-pull step knows
    // which categoryId to filter on. If a store names it differently, the
    // user can flip the toggle manually on the categories page.
    const otherIds = new Set(
      flat
        .filter((c) => /^other$/i.test(c.name.trim()))
        .map((c) => c.categoryId)
    );

    // Build the rows to upsert. isAlabamaRelated and isOtherBucket are only
    // honored on INSERT (new categories) — for existing ones, the upsert
    // clause skips those columns so manual edits stick.
    const rows = flat.map((c) => ({
      categoryId: c.categoryId,
      parentCategoryId: c.parentCategoryId,
      name: c.name,
      order: c.order,
      isAlabamaRelated: scoreAlabama(c.name).isAlabamaRelated,
      isOtherBucket: otherIds.has(c.categoryId),
      lastSyncedAt: new Date(),
    }));

    // Upsert in chunks of 500 — Postgres has a parameter limit per query.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await db
        .insert(ebayStoreCategories)
        .values(slice)
        .onConflictDoUpdate({
          target: ebayStoreCategories.categoryId,
          set: {
            // Refresh structural fields on existing rows. Crucially, we do
            // NOT set isAlabamaRelated or isOtherBucket here — those stay
            // as the user last left them. "order" is a reserved word in
            // PostgreSQL so it has to be quoted in raw sql fragments.
            parentCategoryId: sql`excluded.parent_category_id`,
            name: sql`excluded.name`,
            order: sql`excluded."order"`,
            lastSyncedAt: sql`excluded.last_synced_at`,
          },
        });
    }

    await db.insert(ebaySyncLog).values({
      action: "sync-categories",
      success: true,
      itemCount: rows.length,
      details: {
        topLevelCount: tree.length,
        autoDetectedAlabama: rows.filter((r) => r.isAlabamaRelated).length,
        autoDetectedOther: otherIds.size,
      },
      startedAt: new Date(start),
      endedAt: new Date(),
    });

    return NextResponse.json({
      ok: true,
      totalCount: rows.length,
      topLevelCount: tree.length,
      otherDetected: Array.from(otherIds),
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const message = (err as Error).message;
    await db
      .insert(ebaySyncLog)
      .values({
        action: "sync-categories",
        success: false,
        errorMessage: message,
        startedAt: new Date(start),
        endedAt: new Date(),
      })
      .catch(() => {
        // If even the log insert fails, swallow — we'll surface the original
        // error in the response.
      });
    return NextResponse.json(
      { ok: false, error: message, durationMs: Date.now() - start },
      { status: 500 }
    );
  }
}
