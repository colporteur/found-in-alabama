// Cost accounting for the Expert Enhance pipeline.
//
// Every AI call and HTTP-service call logs a row to ai_call_log with a
// USD cost computed at call time. Rates come from the ai_model_pricing
// table (editable), falling back to the hardcoded defaults below. The
// defaults are lazily seeded into the table on first use so Todd can see
// and adjust them.
//
// Units: per-MTok rates are USD per million tokens. perRequestUsd is the
// flat cost of one billable request (APR research calls).

import { db, aiCallLog, aiModelPricing } from "@/db";
import { and, eq } from "drizzle-orm";

export type PricingRate = {
  provider: string;
  model: string;
  inputPerMTok?: number;
  outputPerMTok?: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
  perRequestUsd?: number;
  notes?: string;
};

// Sonnet 5 intro pricing ($2/$10) runs through 2026-08-31, then $3/$15.
// Date-switch here so the fallback stays correct without a manual edit;
// a DB row, once seeded, wins — update it after 2026-08-31 if seeded
// during the intro window (the dashboard shows a reminder).
const SONNET5_INTRO_ENDS = new Date("2026-09-01T00:00:00Z");

function sonnet5Rate(): PricingRate {
  const intro = new Date() < SONNET5_INTRO_ENDS;
  return {
    provider: "anthropic",
    model: "claude-sonnet-5",
    inputPerMTok: intro ? 2 : 3,
    outputPerMTok: intro ? 10 : 15,
    cacheReadPerMTok: intro ? 0.2 : 0.3,
    cacheWritePerMTok: intro ? 2.5 : 3.75,
    notes: intro
      ? "Intro pricing through 2026-08-31; update to 3/15 after."
      : "Standard pricing.",
  };
}

/** Hardcoded fallbacks. DB rows (ai_model_pricing) take precedence. */
export function defaultRates(): PricingRate[] {
  return [
    sonnet5Rate(),
    {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      inputPerMTok: 1,
      outputPerMTok: 5,
      cacheReadPerMTok: 0.1,
      cacheWritePerMTok: 1.25,
    },
    {
      provider: "openai",
      model: "gpt-4o-mini",
      inputPerMTok: 0.15,
      outputPerMTok: 0.6,
      cacheReadPerMTok: 0.075,
      notes: "Verify against current OpenAI pricing before Phase 2 runs.",
    },
    {
      provider: "gemini",
      model: "gemini-2.0-flash",
      inputPerMTok: 0.1,
      outputPerMTok: 0.4,
      notes: "Verify against current Google pricing before Phase 2 runs.",
    },
    {
      provider: "apr",
      model: "research",
      perRequestUsd: 0.03,
      notes:
        "APR uses ScrapingBee stealth_proxy (~75 credits/req, 1-2 reqs/job on the $49/250k plan) + pennies of Gemini vision. Conservative pass-through.",
    },
    {
      provider: "apr",
      model: "quick_lookup",
      perRequestUsd: 0.01,
      notes: "APR Quick Lookup mode (~$0.01/call per Item ID App usage).",
    },
  ];
}

// In-memory cache of resolved rates, reset per cold start. Vercel
// functions are short-lived so staleness is bounded; the dashboard reads
// the table directly.
const rateCache = new Map<string, PricingRate>();

function toNum(v: string | null): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve the rate for (provider, model): DB row wins, else hardcoded
 * default (which is then seeded into the DB for visibility), else a
 * zero-cost rate with a warning note.
 */
export async function getRate(provider: string, model: string): Promise<PricingRate> {
  const key = `${provider}:${model}`;
  const cached = rateCache.get(key);
  if (cached) return cached;

  const [row] = await db
    .select()
    .from(aiModelPricing)
    .where(and(eq(aiModelPricing.provider, provider), eq(aiModelPricing.model, model)))
    .limit(1);

  if (row) {
    const rate: PricingRate = {
      provider,
      model,
      inputPerMTok: toNum(row.inputPerMTok),
      outputPerMTok: toNum(row.outputPerMTok),
      cacheReadPerMTok: toNum(row.cacheReadPerMTok),
      cacheWritePerMTok: toNum(row.cacheWritePerMTok),
      perRequestUsd: toNum(row.perRequestUsd),
      notes: row.notes ?? undefined,
    };
    rateCache.set(key, rate);
    return rate;
  }

  const fallback = defaultRates().find((r) => r.provider === provider && r.model === model);
  if (fallback) {
    // Seed so it shows up in the editable table. Best-effort; a race
    // with another function instance just means one insert loses.
    try {
      await db
        .insert(aiModelPricing)
        .values({
          provider,
          model,
          inputPerMTok: fallback.inputPerMTok?.toString(),
          outputPerMTok: fallback.outputPerMTok?.toString(),
          cacheReadPerMTok: fallback.cacheReadPerMTok?.toString(),
          cacheWritePerMTok: fallback.cacheWritePerMTok?.toString(),
          perRequestUsd: fallback.perRequestUsd?.toString(),
          notes: fallback.notes,
        })
        .onConflictDoNothing();
    } catch {
      // non-fatal
    }
    rateCache.set(key, fallback);
    return fallback;
  }

  const unknown: PricingRate = {
    provider,
    model,
    notes: "UNKNOWN MODEL — cost logged as $0. Add a row to ai_model_pricing.",
  };
  rateCache.set(key, unknown);
  return unknown;
}

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/** Compute USD cost of one LLM call from its token usage. */
export function computeLlmCost(rate: PricingRate, usage: LlmUsage): number {
  const per = (tokens: number | undefined, perM: number | undefined) =>
    ((tokens ?? 0) / 1_000_000) * (perM ?? 0);
  return (
    per(usage.inputTokens, rate.inputPerMTok) +
    per(usage.outputTokens, rate.outputPerMTok) +
    per(usage.cacheReadTokens, rate.cacheReadPerMTok) +
    per(usage.cacheWriteTokens, rate.cacheWritePerMTok)
  );
}

export type LogCallParams = {
  op: string;
  batchId?: string | null;
  jobId?: string | null;
  category: "llm" | "http_service";
  provider: string;
  model: string;
  usage?: LlmUsage;
  requestCount?: number;
  costUsd: number;
  durationMs?: number;
  success?: boolean;
  errorMessage?: string;
};

/** Write one row to ai_call_log. Never throws — cost logging must not break the op. */
export async function logAiCall(p: LogCallParams): Promise<void> {
  try {
    await db.insert(aiCallLog).values({
      op: p.op,
      batchId: p.batchId ?? null,
      jobId: p.jobId ?? null,
      category: p.category,
      provider: p.provider,
      model: p.model,
      inputTokens: p.usage?.inputTokens ?? null,
      outputTokens: p.usage?.outputTokens ?? null,
      cacheReadTokens: p.usage?.cacheReadTokens ?? null,
      cacheWriteTokens: p.usage?.cacheWriteTokens ?? null,
      requestCount: p.requestCount ?? 1,
      costUsd: p.costUsd.toFixed(6),
      durationMs: p.durationMs ?? null,
      success: p.success ?? true,
      errorMessage: p.errorMessage ?? null,
    });
  } catch (err) {
    console.error("[enhance] failed to log AI call:", err);
  }
}
