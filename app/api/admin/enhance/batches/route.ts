// POST /api/admin/enhance/batches — preview (dryRun) or create an
// Expert Enhance batch.
//
// The listing selection resolves against the local ebay_listings mirror
// (kept fresh by the sync-listings cron) — never a live GetSellerList
// walk, which 504s at this store's size. Op handlers re-fetch each item
// live at run time, so mirror staleness can't cause a wrong mutation,
// only a skipped one.
//
// Body:
//   op:        "price_adjust" | "sku_rename"
//   label?:    string
//   config:    op-specific (see lib/enhance/ops.ts)
//   selection: { itemIds? | skuExact? | skuPrefix? | skuContains? |
//                storeCategoryId? | titleContains? | priceMin? | priceMax? }
//   dryRun?:   true → return match count + sample, create nothing

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, ebayListings } from "@/db";
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { createBatch } from "@/lib/enhance/queue";
import { getOpHandler } from "@/lib/enhance/ops";
import type { EnhanceOp } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PHASE1_OPS: EnhanceOp[] = ["price_adjust", "sku_rename"];

type Selection = {
  itemIds?: string[];
  skuExact?: string;
  skuPrefix?: string;
  skuContains?: string;
  storeCategoryId?: string;
  titleContains?: string;
  priceMin?: number;
  priceMax?: number;
};

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function selectionFilters(sel: Selection): SQL[] {
  const filters: SQL[] = [];
  if (sel.itemIds && sel.itemIds.length > 0) {
    filters.push(inArray(ebayListings.itemId, sel.itemIds));
  }
  if (sel.skuExact) filters.push(eq(ebayListings.sku, sel.skuExact));
  if (sel.skuPrefix) {
    filters.push(ilike(ebayListings.sku, `${escapeLike(sel.skuPrefix)}%`));
  }
  if (sel.skuContains) {
    filters.push(ilike(ebayListings.sku, `%${escapeLike(sel.skuContains)}%`));
  }
  if (sel.storeCategoryId) {
    filters.push(
      or(
        eq(ebayListings.storeCategory1Id, sel.storeCategoryId),
        eq(ebayListings.storeCategory2Id, sel.storeCategoryId)
      )!
    );
  }
  if (sel.titleContains) {
    filters.push(ilike(ebayListings.title, `%${escapeLike(sel.titleContains)}%`));
  }
  if (sel.priceMin !== undefined && Number.isFinite(sel.priceMin)) {
    filters.push(sql`${ebayListings.price} >= ${sel.priceMin}`);
  }
  if (sel.priceMax !== undefined && Number.isFinite(sel.priceMax)) {
    filters.push(sql`${ebayListings.price} <= ${sel.priceMax}`);
  }
  return filters;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    op?: string;
    label?: string;
    config?: Record<string, unknown>;
    selection?: Selection;
    dryRun?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const op = body.op as EnhanceOp;
  if (!PHASE1_OPS.includes(op)) {
    return NextResponse.json(
      { error: `op must be one of: ${PHASE1_OPS.join(", ")}` },
      { status: 400 }
    );
  }
  const config = body.config ?? {};
  const sel: Selection = body.selection ?? {};

  // Convenience: a sku_rename with no explicit selection targets the SKUs
  // its own find/mode describe.
  if (
    op === "sku_rename" &&
    !sel.itemIds?.length &&
    !sel.skuExact &&
    !sel.skuPrefix &&
    !sel.skuContains &&
    !sel.storeCategoryId &&
    !sel.titleContains
  ) {
    const find = typeof config.find === "string" ? config.find : "";
    const mode = config.mode;
    if (find) {
      if (mode === "prefix") sel.skuPrefix = find;
      else if (mode === "contains") sel.skuContains = find;
      else sel.skuExact = find;
    }
  }

  const filters = selectionFilters(sel);
  if (filters.length === 0) {
    return NextResponse.json(
      { error: "Selection matches the entire store — add at least one filter" },
      { status: 400 }
    );
  }

  const matched = await db
    .select({
      itemId: ebayListings.itemId,
      sku: ebayListings.sku,
      title: ebayListings.title,
      price: ebayListings.price,
    })
    .from(ebayListings)
    .where(and(...filters))
    .orderBy(asc(ebayListings.itemId));

  const handler = getOpHandler(op);
  const perJob = handler
    ? handler.estimateCostPerJob({ op, config, modelOverride: null })
    : 0;
  const estimatedCostUsd = perJob * matched.length;

  if (body.dryRun) {
    return NextResponse.json({
      matched: matched.length,
      estimatedCostUsd,
      sample: matched.slice(0, 10),
    });
  }

  if (matched.length === 0) {
    return NextResponse.json(
      { error: "Selection matched no listings" },
      { status: 400 }
    );
  }

  const batch = await createBatch({
    op,
    label: body.label ?? "",
    config,
    items: matched.map((m) => ({
      ebayItemId: m.itemId,
      sku: m.sku,
      title: m.title,
    })),
  });

  return NextResponse.json({ batch, matched: matched.length, estimatedCostUsd });
}
