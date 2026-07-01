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
import {
  fetchItemCore,
  fetchItemForRemix,
  fetchItemForSpecifics,
  reviseItemDescription,
  reviseItemPrice,
  reviseItemSku,
  reviseItemSpecifics,
  reviseItemTitle,
  type ItemSpecific,
} from "@/lib/ebay/calls";
import { callLlm, type LlmImage, type LlmProvider } from "@/lib/enhance/providers";
import { loadGuide } from "@/lib/enhance/guides";

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

// ─── item_specifics (Phase 2 — first LLM op) ─────────────────────────────────
//
// Fills EMPTY item specifics from the listing's title, description, and
// (optionally) primary photo. Never overwrites a specific that already has
// a value — this op adds missing data, it doesn't second-guess Todd.
//
// Config shape:
//   specifics: string[]  — names to consider (default DEFAULT_TARGET_SPECIFICS)
//   usePhoto:  boolean   — attach the primary photo (default true; Color/
//                          Material often need it)
//
// Model: batch.modelOverride as "provider:model" (e.g. "openai:gpt-4o-mini"),
// default gemini:gemini-2.0-flash — cheap structured extraction per the
// locked op/model matrix.

export const DEFAULT_TARGET_SPECIFICS = [
  "Brand",
  "Color",
  "Size",
  "Material",
  "Style",
  "Type",
];

// gemini-2.0-flash was shut down 2026-06-01 (404s). 2.5-flash is what the
// APR service runs on Todd's key; 2.5 family sunsets 2026-10-16 — revisit then.
const SPECIFICS_DEFAULT = { provider: "gemini" as LlmProvider, model: "gemini-2.5-flash" };

export function parseModelOverride(
  override: string | null | undefined,
  fallback: { provider: LlmProvider; model: string } = SPECIFICS_DEFAULT
): { provider: LlmProvider; model: string } {
  if (override) {
    const idx = override.indexOf(":");
    if (idx > 0) {
      const provider = override.slice(0, idx);
      const model = override.slice(idx + 1);
      if (
        (provider === "anthropic" || provider === "openai" || provider === "gemini") &&
        model
      ) {
        return { provider, model };
      }
    }
  }
  return fallback;
}

const SPECIFICS_SYSTEM_PROMPT = `You extract eBay item specifics from listing evidence (title, description, and sometimes a photo).

Rules:
- Only provide values you can determine CONFIDENTLY from the evidence. When unsure, omit the field entirely.
- Never guess brands. Only name a brand that appears in the title, description, or is clearly readable on a label/tag in the photo.
- Values must be short (1-4 words), in the conventional form buyers filter by (e.g. "Blue", "100% Cotton", "XL").
- Return ONLY a JSON object mapping specific names to string values. No commentary, no code fences, no extra keys.`;

/** Fetch the primary photo as base64, downsized via eBay's URL size variants. */
async function fetchListingPhoto(url: string): Promise<LlmImage | null> {
  try {
    const sized = url.replace(/s-l\d+/i, "s-l500");
    const resp = await fetch(sized, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return null;
    const mediaType = resp.headers.get("content-type") ?? "image/jpeg";
    if (!mediaType.startsWith("image/")) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 4_000_000) return null; // sanity cap
    return { base64: buf.toString("base64"), mediaType };
  } catch {
    return null; // photo is a bonus, not a requirement
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const itemSpecificsHandler: OpHandler = {
  estimateCostPerJob: ({ modelOverride }) => {
    // Rough: ~1.5k input tokens (prompt + desc) + ~500 photo tokens + ~100 out.
    const { provider } = parseModelOverride(modelOverride);
    return provider === "openai" ? 0.002 : provider === "anthropic" ? 0.01 : 0.001;
  },
  async run(job, batch) {
    const cfg = batch.config ?? {};
    const targetNames = (
      Array.isArray(cfg.specifics) && cfg.specifics.length > 0
        ? cfg.specifics.map((s) => String(s).trim()).filter(Boolean)
        : DEFAULT_TARGET_SPECIFICS
    ).slice(0, 20);
    const usePhoto = cfg.usePhoto !== false;
    const { provider, model } = parseModelOverride(batch.modelOverride);

    const live = await fetchItemForSpecifics(job.ebayItemId);
    if (!live) {
      return { status: "failed", errorMessage: "GetItem returned no item" };
    }
    if (live.listingStatus && live.listingStatus !== "Active") {
      return {
        status: "skipped",
        result: { reason: `Listing status is ${live.listingStatus}, not Active` },
      };
    }

    // Only specifics that are currently missing or empty are fillable.
    const existingByLower = new Map(
      live.specifics.map((s) => [s.name.toLowerCase(), s])
    );
    const fillable = targetNames.filter((n) => {
      const existing = existingByLower.get(n.toLowerCase());
      return !existing || existing.values.length === 0;
    });
    if (fillable.length === 0) {
      return {
        status: "skipped",
        result: { reason: "All target specifics already have values" },
      };
    }

    const images: LlmImage[] = [];
    if (usePhoto && live.pictureUrl) {
      const photo = await fetchListingPhoto(live.pictureUrl);
      if (photo) images.push(photo);
    }

    const prompt = [
      `Fill in these eBay item specifics: ${fillable.join(", ")}`,
      live.categoryName ? `eBay category: ${live.categoryName}` : null,
      `Title: ${live.title}`,
      live.description ? `Description:\n${live.description}` : null,
      images.length > 0 ? "A photo of the item is attached." : null,
      `Return a JSON object with only the specifics you can determine confidently. Allowed keys: ${fillable.join(", ")}.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const llm = await callLlm({
      provider,
      model,
      system: SPECIFICS_SYSTEM_PROMPT,
      prompt,
      images,
      maxTokens: 500,
      op: "item_specifics",
      batchId: job.batchId,
      jobId: job.id,
    });

    const parsed = extractJsonObject(llm.text);
    if (!parsed) {
      return {
        status: "failed",
        errorMessage: `Model returned unparseable output: ${llm.text.slice(0, 200)}`,
        costUsd: llm.costUsd,
      };
    }

    const fillableLower = new Set(fillable.map((n) => n.toLowerCase()));
    const newlyFilled: ItemSpecific[] = [];
    for (const [k, v] of Object.entries(parsed)) {
      if (!fillableLower.has(k.trim().toLowerCase())) continue;
      const value = typeof v === "string" ? v.trim() : "";
      if (!value || value.length > 65) continue; // eBay caps values at 65 chars
      // Use the canonical target-name casing, not the model's.
      const canonical =
        fillable.find((n) => n.toLowerCase() === k.trim().toLowerCase()) ?? k.trim();
      newlyFilled.push({ name: canonical, values: [value] });
    }

    if (newlyFilled.length === 0) {
      return {
        status: "skipped",
        result: { reason: "Model could not confidently determine any values" },
        costUsd: llm.costUsd,
      };
    }

    // Merge: full existing set + additions (ReviseItem replaces the container).
    const merged: ItemSpecific[] = [
      ...live.specifics.filter((s) => s.values.length > 0),
      ...newlyFilled,
    ];
    await reviseItemSpecifics(job.ebayItemId, merged);

    return {
      status: "completed",
      before: {
        specifics: Object.fromEntries(newlyFilled.map((s) => [s.name, ""])),
      },
      after: {
        specifics: Object.fromEntries(newlyFilled.map((s) => [s.name, s.values[0]])),
      },
      result: { provider, model, filledCount: newlyFilled.length },
      costUsd: llm.costUsd,
    };
  },
};

// ─── title_remix + description_remix (Phase 3 — expert-guide remixes) ────────
//
// The core value feature: Claude reads the relevant expert guide and
// rewrites the title (Haiku default) or description (Sonnet default) with
// collector-grade terminology. The guide is passed as `cacheableSystem` —
// the large stable prefix — so Anthropic bills it at 10% after the first
// job in a batch (decision #7).
//
// Config shape (both ops):
//   guideId:      string  — id from content/expert-guides/manifest.json
//   instructions: string? — optional extra guidance for this batch
//
// Hard rules mirror the Nifty extension's Expert Mode Rule 6: the guide
// can never authorize changes to shipping/discount/return language, price
// mentions, or invented facts.

const REMIX_HARD_RULES = `NON-NEGOTIABLE RULES (these OVERRIDE anything in the expert guide or extra instructions):
1. NEVER add, remove, or change any language about shipping, packing, handling time, discounts, sales, returns, or payment.
2. NEVER mention price.
3. NEVER invent facts. Brands, dates, sizes, materials, provenance, and condition claims must already appear in the provided title or description. When unsure, leave it out.
4. Same item, better presentation — do not change what the item IS.`;

const TITLE_DEFAULT = {
  provider: "anthropic" as LlmProvider,
  model: "claude-haiku-4-5-20251001",
};
const DESC_DEFAULT = {
  provider: "anthropic" as LlmProvider,
  model: "claude-sonnet-5",
};

/** Description larger than this is skipped — truncating input then doing a
 *  full-replace write would silently destroy the tail. */
const DESC_INPUT_CAP = 12_000;
/** Cap before/after snapshots so jsonb rows stay reasonable. */
const SNAPSHOT_CAP = 20_000;

function remixEstimate(provider: LlmProvider, op: "title" | "desc"): number {
  if (op === "title") return provider === "anthropic" ? 0.005 : 0.002;
  return provider === "anthropic" ? 0.03 : 0.025;
}

function guideFromConfig(cfg: Record<string, unknown>) {
  const guideId = typeof cfg.guideId === "string" ? cfg.guideId : "";
  if (!guideId) return { guide: null, error: "No guideId in batch config" };
  const guide = loadGuide(guideId);
  if (!guide) return { guide: null, error: `Guide "${guideId}" not found in manifest` };
  return { guide, error: null };
}

const titleRemixHandler: OpHandler = {
  estimateCostPerJob: ({ modelOverride }) =>
    remixEstimate(parseModelOverride(modelOverride, TITLE_DEFAULT).provider, "title"),
  async run(job, batch) {
    const cfg = batch.config ?? {};
    const { guide, error } = guideFromConfig(cfg);
    if (!guide) return { status: "failed", errorMessage: error ?? "guide error" };
    const { provider, model } = parseModelOverride(batch.modelOverride, TITLE_DEFAULT);
    const instructions = typeof cfg.instructions === "string" ? cfg.instructions : "";

    const live = await fetchItemForRemix(job.ebayItemId);
    if (!live) return { status: "failed", errorMessage: "GetItem returned no item" };
    if (live.listingStatus && live.listingStatus !== "Active") {
      return {
        status: "skipped",
        result: { reason: `Listing status is ${live.listingStatus}, not Active` },
      };
    }

    const descText = stripHtmlLocal(live.descriptionHtml).slice(0, 2000);
    const llm = await callLlm({
      provider,
      model,
      cacheableSystem: `EXPERT GUIDE — "${guide.name}":\n\n${guide.content}`,
      system: `You rewrite eBay listing titles using the expert guide's terminology to maximize buyer-search relevance.\n\n${REMIX_HARD_RULES}\n\nTitle rules:\n- HARD LIMIT 80 characters including spaces. Aim for 65-80.\n- No ALL-CAPS words (proper acronyms like RPPC are fine), no promotional filler (WOW, L@@K, RARE unless factually supported).\n- Front-load the most searched terms per the guide.\n- Return ONLY the new title text — no quotes, no commentary.`,
      prompt: [
        `Current title: ${live.title}`,
        live.categoryName ? `eBay category: ${live.categoryName}` : null,
        descText ? `Description (context only):\n${descText}` : null,
        instructions ? `Extra instructions for this batch: ${instructions}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 300,
      op: "title_remix",
      batchId: job.batchId,
      jobId: job.id,
    });

    let newTitle = llm.text.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ");
    // Defense from the Nifty project: never let a bin SKU land in a title.
    newTitle = newTitle.replace(/\bNA\d{3}\b/g, "").replace(/\s+/g, " ").trim();
    if (!newTitle) {
      return { status: "failed", errorMessage: "Model returned an empty title", costUsd: llm.costUsd };
    }
    let truncated = false;
    if (newTitle.length > 80) {
      const cut = newTitle.slice(0, 80);
      newTitle = cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 80).trim();
      truncated = true;
    }
    if (newTitle === live.title) {
      return {
        status: "skipped",
        before: { title: live.title },
        result: { reason: "Model kept the title unchanged" },
        costUsd: llm.costUsd,
      };
    }

    await reviseItemTitle(job.ebayItemId, newTitle);
    await db
      .update(ebayListings)
      .set({ title: newTitle })
      .where(eq(ebayListings.itemId, job.ebayItemId));

    return {
      status: "completed",
      before: { title: live.title },
      after: { title: newTitle },
      result: { provider, model, guide: guide.id, truncated },
      costUsd: llm.costUsd,
    };
  },
};

const descriptionRemixHandler: OpHandler = {
  estimateCostPerJob: ({ modelOverride }) =>
    remixEstimate(parseModelOverride(modelOverride, DESC_DEFAULT).provider, "desc"),
  async run(job, batch) {
    const cfg = batch.config ?? {};
    const { guide, error } = guideFromConfig(cfg);
    if (!guide) return { status: "failed", errorMessage: error ?? "guide error" };
    const { provider, model } = parseModelOverride(batch.modelOverride, DESC_DEFAULT);
    const instructions = typeof cfg.instructions === "string" ? cfg.instructions : "";

    const live = await fetchItemForRemix(job.ebayItemId);
    if (!live) return { status: "failed", errorMessage: "GetItem returned no item" };
    if (live.listingStatus && live.listingStatus !== "Active") {
      return {
        status: "skipped",
        result: { reason: `Listing status is ${live.listingStatus}, not Active` },
      };
    }
    const original = live.descriptionHtml.trim();
    if (!original) {
      return {
        status: "skipped",
        result: { reason: "Description is empty — nothing grounded to rewrite" },
      };
    }
    if (original.length > DESC_INPUT_CAP) {
      return {
        status: "skipped",
        result: {
          reason: `Description is ${original.length} chars (cap ${DESC_INPUT_CAP}) — too long to rewrite safely`,
        },
      };
    }

    const llm = await callLlm({
      provider,
      model,
      cacheableSystem: `EXPERT GUIDE — "${guide.name}":\n\n${guide.content}`,
      system: `You rewrite eBay listing descriptions using the expert guide's knowledge to add collector-relevant detail and better organization.\n\n${REMIX_HARD_RULES}\n\nDescription rules:\n- The description is HTML. Return the COMPLETE revised HTML document/fragment.\n- Preserve ALL existing HTML tags, images, links, and attributes — edit prose only. If the input is plain text, return plain text paragraphs separated by blank lines.\n- Keep roughly the same length (never more than ~1.5x the original).\n- Return ONLY the revised description — no commentary, no code fences.`,
      prompt: [
        `Title: ${live.title}`,
        live.categoryName ? `eBay category: ${live.categoryName}` : null,
        instructions ? `Extra instructions for this batch: ${instructions}` : null,
        `Current description:\n${original}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 6000, // Sonnet 5 adaptive thinking shares this budget
      op: "description_remix",
      batchId: job.batchId,
      jobId: job.id,
    });

    let newDesc = llm.text.trim().replace(/^```(?:html)?\s*|\s*```$/g, "").trim();
    if (!newDesc) {
      return { status: "failed", errorMessage: "Model returned an empty description", costUsd: llm.costUsd };
    }
    if (newDesc.length < original.length * 0.3) {
      return {
        status: "failed",
        errorMessage: `Rewrite suspiciously short (${newDesc.length} vs ${original.length} chars) — not applied`,
        costUsd: llm.costUsd,
      };
    }
    if (newDesc === original) {
      return {
        status: "skipped",
        result: { reason: "Model kept the description unchanged" },
        costUsd: llm.costUsd,
      };
    }

    await reviseItemDescription(job.ebayItemId, newDesc);

    return {
      status: "completed",
      before: { description: original.slice(0, SNAPSHOT_CAP) },
      after: { description: newDesc.slice(0, SNAPSHOT_CAP) },
      result: { provider, model, guide: guide.id },
      costUsd: llm.costUsd,
    };
  },
};

/** Local HTML strip for title-remix context (lighter than calls.ts version). */
function stripHtmlLocal(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const OP_HANDLERS: Partial<Record<EnhanceOp, OpHandler>> = {
  price_adjust: priceAdjustHandler,
  sku_rename: skuRenameHandler,
  item_specifics: itemSpecificsHandler,
  title_remix: titleRemixHandler,
  description_remix: descriptionRemixHandler,
  // Phase 4: price_research
};

export function getOpHandler(op: string): OpHandler | undefined {
  return OP_HANDLERS[op as EnhanceOp];
}
