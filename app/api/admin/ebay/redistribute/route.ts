// POST /api/admin/ebay/redistribute — turn a subcategory proposal into
// store_category batches.
//
// Given the analysis scope (source category + keyword) and an ordered
// list of assignments {storeCategoryId, hints[]}, this routes each
// matching item by title hints — FIRST MATCH WINS, so put specific
// subcategories before broad ones — and creates one enhance batch per
// assignment. An assignment with an empty hints list is the catch-all:
// it claims everything left. Items already sitting in one of the target
// categories are excluded (idempotent re-runs).
//
// No AI — hint routing is plain ILIKE. The batches run on the normal
// queue with full history and rollback.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, ebayListings, ebayStoreCategories } from "@/db";
import { and, eq, gt, ilike, inArray, isNull, notInArray, or } from "drizzle-orm";
import { createBatch } from "@/lib/enhance/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Assignment = { storeCategoryId: string; hints: string[]; label?: string };

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    categoryId?: string;
    keyword?: string;
    assignments?: Assignment[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const categoryId = body.categoryId?.trim() || null;
  const keyword = body.keyword?.trim() || null;
  const assignments = (body.assignments ?? []).filter(
    (a) => typeof a.storeCategoryId === "string" && a.storeCategoryId
  );
  if ((!categoryId && !keyword) || assignments.length === 0) {
    return NextResponse.json(
      { error: "Need a source (categoryId/keyword) and at least one assignment" },
      { status: 400 }
    );
  }

  // Resolve target category names for labels.
  const targetIds = assignments.map((a) => a.storeCategoryId);
  const targets = await db
    .select({
      categoryId: ebayStoreCategories.categoryId,
      name: ebayStoreCategories.name,
    })
    .from(ebayStoreCategories)
    .where(inArray(ebayStoreCategories.categoryId, targetIds));
  const nameById = new Map(targets.map((t) => [t.categoryId, t.name]));
  const unknown = targetIds.filter((id) => !nameById.has(id));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown store category id(s): ${unknown.join(", ")} — run Sync categories first` },
      { status: 400 }
    );
  }

  // Candidate pool: the analysis scope, minus items already in a target.
  const scopeMatchers = [];
  if (categoryId) {
    scopeMatchers.push(
      or(
        eq(ebayListings.storeCategory1Id, categoryId),
        eq(ebayListings.storeCategory2Id, categoryId)
      )
    );
  }
  if (keyword) {
    scopeMatchers.push(ilike(ebayListings.title, `%${escapeLike(keyword)}%`));
  }
  const pool = await db
    .select({ itemId: ebayListings.itemId, title: ebayListings.title })
    .from(ebayListings)
    .where(
      and(
        gt(ebayListings.quantity, 0),
        or(...scopeMatchers),
        // NOT IN drops NULL rows — keep uncategorized strays in the pool.
        or(
          isNull(ebayListings.storeCategory1Id),
          notInArray(ebayListings.storeCategory1Id, targetIds)
        )
      )
    );

  // Route: first match wins, in assignment order; empty hints = catch-all.
  const claimed = new Set<string>();
  const results: Array<{ name: string; matched: number; batchId: string | null }> = [];

  for (const a of assignments) {
    const hints = (a.hints ?? [])
      .map((h) => String(h).trim().toLowerCase())
      .filter(Boolean);
    const mine = pool.filter((item) => {
      if (claimed.has(item.itemId)) return false;
      if (hints.length === 0) return true; // catch-all
      const t = item.title.toLowerCase();
      return hints.some((h) => t.includes(h));
    });
    for (const m of mine) claimed.add(m.itemId);

    const name = nameById.get(a.storeCategoryId) ?? a.storeCategoryId;
    if (mine.length === 0) {
      results.push({ name, matched: 0, batchId: null });
      continue;
    }
    const batch = await createBatch({
      op: "store_category",
      label: `Distribute → ${a.label ?? name}`,
      config: { category1Id: a.storeCategoryId },
      items: mine.map((m) => ({ ebayItemId: m.itemId, sku: null, title: m.title })),
    });
    results.push({ name, matched: mine.length, batchId: batch.id });
  }

  const leftovers = pool.length - claimed.size;
  return NextResponse.json({
    poolSize: pool.length,
    batches: results,
    leftovers,
    note:
      leftovers > 0
        ? `${leftovers} item(s) matched no hints — add a catch-all assignment (empty hints) or let auto-categorize handle them`
        : undefined,
  });
}
