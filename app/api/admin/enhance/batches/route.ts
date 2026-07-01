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
import {
  computeAdjustedPrice,
  computeRenamedSku,
  getOpHandler,
  DEFAULT_TARGET_SPECIFICS,
  type PriceAdjustConfig,
  type SkuRenameConfig,
} from "@/lib/enhance/ops";
import { fetchItemForSpecifics } from "@/lib/ebay/calls";
import { decodeEntities } from "@/lib/ebay/entities";
import type { EnhanceOp } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPPORTED_OPS: EnhanceOp[] = ["price_adjust", "sku_rename", "item_specifics"];

/**
 * Projected "after" value for one preview row, computed from the same
 * functions the op handler uses. Indicative only — handlers re-fetch the
 * live item at run time (the mirror price may be slightly stale).
 */
function projectAfter(
  op: EnhanceOp,
  config: Record<string, unknown>,
  row: { sku: string | null; price: string | null }
): string | null {
  if (op === "price_adjust") {
    const price = row.price !== null ? Number(row.price) : NaN;
    const mode = config.mode;
    const delta = Number(config.delta);
    if (!Number.isFinite(price) || (mode !== "percent" && mode !== "flat") || !Number.isFinite(delta)) {
      return null;
    }
    const cfg: PriceAdjustConfig = {
      mode,
      delta,
      floor: Number.isFinite(Number(config.floor)) && config.floor !== undefined && config.floor !== ""
        ? Number(config.floor)
        : undefined,
      round87: config.round87 === true,
    };
    return `$${computeAdjustedPrice(price, cfg).toFixed(2)}`;
  }
  if (op === "sku_rename") {
    if (typeof config.find !== "string" || typeof config.replace !== "string") return null;
    const cfg: SkuRenameConfig = {
      find: config.find,
      replace: config.replace,
      mode:
        config.mode === "prefix" || config.mode === "contains"
          ? config.mode
          : "exact",
    };
    const renamed = computeRenamedSku(row.sku ?? "", cfg);
    return renamed ?? "(no match — will skip)";
  }
  return null; // item_specifics: outcome unknowable before the LLM runs
}

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
    modelOverride?: string;
    dryRun?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const op = body.op as EnhanceOp;
  if (!SUPPORTED_OPS.includes(op)) {
    return NextResponse.json(
      { error: `op must be one of: ${SUPPORTED_OPS.join(", ")}` },
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

  const matchedRaw = await db
    .select({
      itemId: ebayListings.itemId,
      sku: ebayListings.sku,
      title: ebayListings.title,
      price: ebayListings.price,
    })
    .from(ebayListings)
    .where(and(...filters))
    .orderBy(asc(ebayListings.itemId));

  // Mirror rows synced before the ingestion-side decode may still carry
  // XML entities ("Foo &amp; Bar") — normalize for display and job storage.
  const matched = matchedRaw.map((m) => ({ ...m, title: decodeEntities(m.title) }));

  const modelOverride = body.modelOverride?.trim() || null;
  const handler = getOpHandler(op);
  const perJob = handler
    ? handler.estimateCostPerJob({ op, config, modelOverride })
    : 0;
  const estimatedCostUsd = perJob * matched.length;

  if (body.dryRun) {
    let sample = matched.slice(0, 10).map((m) => ({
      ...m,
      after: projectAfter(op, config, m),
    }));

    // item_specifics: check each sample item LIVE so the preview shows
    // exactly which specifics are empty (will be filled) vs. already set
    // (never touched). ~10 GetItem calls, a few seconds — worth it for
    // the visibility before spending on the LLM.
    if (op === "item_specifics") {
      const targets = (
        Array.isArray(config.specifics) && config.specifics.length > 0
          ? config.specifics.map((s) => String(s).trim()).filter(Boolean)
          : DEFAULT_TARGET_SPECIFICS
      ).slice(0, 20);
      sample = await Promise.all(
        sample.map(async (row) => {
          try {
            const live = await fetchItemForSpecifics(row.itemId);
            if (!live) return { ...row, after: "(item not found on eBay)" };
            const existing = new Map(
              live.specifics.map((s) => [s.name.toLowerCase(), s])
            );
            const fillable = targets.filter((n) => {
              const e = existing.get(n.toLowerCase());
              return !e || e.values.length === 0;
            });
            const alreadySet = targets.filter((n) => !fillable.includes(n));
            const after =
              fillable.length === 0
                ? "nothing to fill — will skip"
                : `will fill: ${fillable.join(", ")}` +
                  (alreadySet.length > 0
                    ? ` · keeps: ${alreadySet.join(", ")}`
                    : "");
            return { ...row, after };
          } catch {
            return { ...row, after: "(could not check live item)" };
          }
        })
      );
    }

    return NextResponse.json({
      matched: matched.length,
      estimatedCostUsd,
      sample,
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
    modelOverride,
    items: matched.map((m) => ({
      ebayItemId: m.itemId,
      sku: m.sku,
      title: m.title,
    })),
  });

  return NextResponse.json({ batch, matched: matched.length, estimatedCostUsd });
}
