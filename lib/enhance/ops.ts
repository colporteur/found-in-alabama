// Op handler registry for the Expert Enhance pipeline.
//
// Each op registers a handler as its phase lands. The batch runner
// (lib/enhance/queue.ts) looks the handler up by op and runs it once per
// job. Phase 1 ships price_adjust and sku_rename — pure math/string ops,
// no AI calls, exercising the queue end to end.
//
// Both handlers fetch the item LIVE (GetItem) before mutating so the
// `before` rollback snapshot and the mutation math reflect reality, not
// the possibly-stale ebay_listings mirror. After a successful ReviseItem
// they write the new value back to the mirror so the admin UI stays
// consistent without waiting for the next sync cron.

import { db, ebayListings } from "@/db";
import { eq } from "drizzle-orm";
import type { EnhanceOp, enhanceBatches, enhanceJobs } from "@/db/schema";
import { fetchItemCore, reviseItemPrice, reviseItemSku } from "@/lib/ebay/calls";

export type EnhanceBatchRow = typeof enhanceBatches.$inferSelect;
export type EnhanceJobRow = typeof enhanceJobs.$inferSelect;

export type OpOutcome = {
  status: "completed" | "failed" | "skipped";
  /** Field values before the mutation (rollback snapshot). */
  before?: Record<string, unknown>;
  /** Field values after the mutation. */
  after?: Record<string, unknown>;
  /** Op-specific detail (AI reasoning, APR job id, etc.). */
  result?: Record<string, unknown>;
  /** Total spend attributable to this job (sum of its AI/service calls). */
  costUsd?: number;
  errorMessage?: string;
};

export type OpHandler = {
  /** Process one job. Must be idempotent-safe: a retried job re-runs this. */
  run: (job: EnhanceJobRow, batch: EnhanceBatchRow) => Promise<OpOutcome>;
  /** Rough per-job cost for the pre-batch "~$X.XX, proceed?" estimator. */
  estimateCostPerJob: (batch: {
    op: EnhanceOp;
    config: Record<string, unknown>;
    modelOverride: string | null;
  }) => number;
};

// ─── price_adjust (Phase 1) ───────────────────────────────────────────────────
//
// Config shape:
//   mode:    "percent" | "flat"   — how to read `delta`
//   delta:   number               — +5 = +5% (or +$5); negative discounts
//   floor:   number               — never go below this (default 0.99)
//   round87: boolean              — round result to nearest .87 (Todd's
//                                   pricing convention, same as the Nifty
//                                   extension)

export type PriceAdjustConfig = {
  mode: "percent" | "flat";
  delta: number;
  floor?: number;
  round87?: boolean;
};

/** Round to the nearest x.87 (12.10 → 11.87, 12.60 → 12.87). */
export function roundTo87(value: number): number {
  const lower = Math.floor(value) - 1 + 0.87;
  const upper = Math.floor(value) + 0.87;
  const nearest = value - lower <= upper - value ? lower : upper;
  return Math.round(nearest * 100) / 100;
}

export function computeAdjustedPrice(
  current: number,
  cfg: PriceAdjustConfig
): number {
  const floor = cfg.floor ?? 0.99;
  let next =
    cfg.mode === "percent" ? current * (1 + cfg.delta / 100) : current + cfg.delta;
  if (cfg.round87) next = roundTo87(next);
  if (next < floor) next = floor;
  return Math.round(next * 100) / 100;
}

const priceAdjustHandler: OpHandler = {
  estimateCostPerJob: () => 0, // no AI — Trading API calls are free
  async run(job, batch) {
    const cfg = parsePriceConfig(batch.config ?? {});
    if (!cfg) {
      return {
        status: "failed",
        errorMessage:
          "Invalid price_adjust config — need { mode: 'percent'|'flat', delta: number }",
      };
    }

    const live = await fetchItemCore(job.ebayItemId);
    if (!live) {
      return { status: "failed", errorMessage: "GetItem returned no item" };
    }
    if (live.listingStatus && live.listingStatus !== "Active") {
      return {
        status: "skipped",
        result: { reason: `Listing status is ${live.listingStatus}, not Active` },
      };
    }
    if (live.listingType === "Chinese") {
      return {
        status: "skipped",
        result: { reason: "Auction-style listing — price revision not supported" },
      };
    }
    if (live.price == null) {
      return { status: "failed", errorMessage: "GetItem returned no price" };
    }

    const newPrice = computeAdjustedPrice(live.price, cfg);
    if (Math.abs(newPrice - live.price) < 0.005) {
      return {
        status: "skipped",
        before: { price: live.price },
        result: { reason: "No change (already at floor or delta rounds to same price)" },
      };
    }

    await reviseItemPrice(job.ebayItemId, newPrice);

    // Sync the local mirror so the admin UI reflects the change now.
    await db
      .update(ebayListings)
      .set({ price: newPrice.toFixed(2) })
      .where(eq(ebayListings.itemId, job.ebayItemId));

    return {
      status: "completed",
      before: { price: live.price },
      after: { price: newPrice },
      result: {
        mode: cfg.mode,
        delta: cfg.delta,
        floorApplied: newPrice === (cfg.floor ?? 0.99),
      },
      costUsd: 0,
    };
  },
};

function parsePriceConfig(raw: Record<string, unknown>): PriceAdjustConfig | null {
  const mode = raw.mode;
  const delta = Number(raw.delta);
  if ((mode !== "percent" && mode !== "flat") || !Number.isFinite(delta)) return null;
  const floor = raw.floor !== undefined ? Number(raw.floor) : undefined;
  return {
    mode,
    delta,
    floor: floor !== undefined && Number.isFinite(floor) ? floor : undefined,
    round87: raw.round87 === true,
  };
}

// ─── sku_rename (Phase 1) ─────────────────────────────────────────────────────
//
// Bin consolidation: NA311 → NA312 and similar. Config shape:
//   find:    string
//   replace: string
//   mode:    "exact" | "prefix" | "contains"  (default "exact")
//
// Jobs whose LIVE SKU no longer matches `find` are skipped, not failed —
// the mirror the batch was built from may have been stale, and "nothing
// to do" isn't an error.

export type SkuRenameConfig = {
  find: string;
  replace: string;
  mode: "exact" | "prefix" | "contains";
};

export function computeRenamedSku(
  current: string,
  cfg: SkuRenameConfig
): string | null {
  if (cfg.mode === "exact") {
    return current === cfg.find ? cfg.replace : null;
  }
  if (cfg.mode === "prefix") {
    return current.startsWith(cfg.find)
      ? cfg.replace + current.slice(cfg.find.length)
      : null;
  }
  return current.includes(cfg.find)
    ? current.split(cfg.find).join(cfg.replace)
    : null;
}

const skuRenameHandler: OpHandler = {
  estimateCostPerJob: () => 0,
  async run(job, batch) {
    const cfg = parseSkuConfig(batch.config ?? {});
    if (!cfg) {
      return {
        status: "failed",
        errorMessage:
          "Invalid sku_rename config — need { find: string, replace: string }",
      };
    }

    const live = await fetchItemCore(job.ebayItemId);
    if (!live) {
      return { status: "failed", errorMessage: "GetItem returned no item" };
    }
    if (live.listingStatus && live.listingStatus !== "Active") {
      return {
        status: "skipped",
        result: { reason: `Listing status is ${live.listingStatus}, not Active` },
      };
    }

    const currentSku = live.sku ?? "";
    const newSku = computeRenamedSku(currentSku, cfg);
    if (newSku === null) {
      return {
        status: "skipped",
        before: { sku: currentSku },
        result: { reason: `Live SKU "${currentSku}" doesn't match "${cfg.find}" (${cfg.mode})` },
      };
    }
    if (newSku === currentSku) {
      return {
        status: "skipped",
        before: { sku: currentSku },
        result: { reason: "Rename is a no-op" },
      };
    }

    await reviseItemSku(job.ebayItemId, newSku);

    await db
      .update(ebayListings)
      .set({ sku: newSku })
      .where(eq(ebayListings.itemId, job.ebayItemId));

    return {
      status: "completed",
      before: { sku: currentSku },
      after: { sku: newSku },
      costUsd: 0,
    };
  },
};

function parseSkuConfig(raw: Record<string, unknown>): SkuRenameConfig | null {
  if (typeof raw.find !== "string" || raw.find.length === 0) return null;
  if (typeof raw.replace !== "string") return null;
  const mode =
    raw.mode === "prefix" || raw.mode === "contains" ? raw.mode : "exact";
  return { find: raw.find, replace: raw.replace, mode };
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const OP_HANDLERS: Partial<Record<EnhanceOp, OpHandler>> = {
  price_adjust: priceAdjustHandler,
  sku_rename: skuRenameHandler,
  // Phase 2: item_specifics
  // Phase 3: title_remix, description_remix
  // Phase 4: price_research
};

export function getOpHandler(op: string): OpHandler | undefined {
  return OP_HANDLERS[op as EnhanceOp];
}
