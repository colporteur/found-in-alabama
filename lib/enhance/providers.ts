// Multi-provider AI abstraction for the Expert Enhance pipeline.
//
// Two categories (locked design decision #2):
//   callLlm()        — any LLM, token-billed — via the AI Gateway
//   callHttpService()— request-billed HTTP services (Agent Price Researcher)
//
// Gateway era (2026-07-09): every callLlm goes through the ai-gateway
// Worker (OpenRouter), so the old per-provider branches collapsed into a
// single call. The `provider` param remains as a cost-log label and for
// the "provider:model" override strings in the UI. Cost now prefers
// OpenRouter's actual billed amount (usage.cost); the ai_model_pricing
// rates remain as fallback when it's missing.
//
// Prompt caching (decision #7): pass `cacheableSystem` for the large
// stable prefix (an expert guide); `system` is the small per-op suffix.
// cache_control passes through OpenRouter to Anthropic models; OpenAI/
// Gemini cache automatically.

import { gatewayChat, normalizeModel, type GatewayContentPart } from "@/lib/gateway";
import {
  computeLlmCost,
  getRate,
  logAiCall,
  type LlmUsage,
} from "@/lib/enhance/cost";

export type LlmProvider = "anthropic" | "openai" | "gemini";

export type LlmImage = { base64: string; mediaType: string };

export type LlmCallParams = {
  provider: LlmProvider;
  model: string;
  /** Large stable prefix (expert guide) — cached on Anthropic. */
  cacheableSystem?: string;
  /** Small per-op system suffix. */
  system?: string;
  /** User content. */
  prompt: string;
  images?: LlmImage[];
  maxTokens: number;
  /** Attribution for the cost log. */
  op: string;
  batchId?: string | null;
  jobId?: string | null;
};

export type LlmResult = {
  text: string;
  usage: LlmUsage;
  costUsd: number;
  durationMs: number;
};

/**
 * Call an LLM provider, log cost, return text. Throws on API errors
 * (after logging the failed call) so op handlers can mark the job failed.
 */
export async function callLlm(p: LlmCallParams): Promise<LlmResult> {
  const started = Date.now();
  const rate = await getRate(p.provider, p.model);
  try {
    const out = await callGateway(p);

    const durationMs = Date.now() - started;
    // Prefer OpenRouter's actual billed cost; fall back to the local
    // rates table when it isn't reported.
    const costUsd = out.costUsd ?? computeLlmCost(rate, out.usage);
    await logAiCall({
      op: p.op,
      batchId: p.batchId,
      jobId: p.jobId,
      category: "llm",
      provider: p.provider,
      model: p.model,
      usage: out.usage,
      costUsd,
      durationMs,
      success: true,
    });
    return { ...out, costUsd, durationMs };
  } catch (err) {
    await logAiCall({
      op: p.op,
      batchId: p.batchId,
      jobId: p.jobId,
      category: "llm",
      provider: p.provider,
      model: p.model,
      costUsd: 0,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── Single gateway path (any provider/model) ─────────────────────────────────

async function callGateway(
  p: LlmCallParams
): Promise<{ text: string; usage: LlmUsage; costUsd?: number }> {
  // System prompt: keep the cacheable guide prefix as its own text part
  // with cache_control (honored by Anthropic models via OpenRouter);
  // other providers just see the concatenated system text.
  const systemParts: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }> = [];
  if (p.cacheableSystem) {
    systemParts.push({
      type: "text",
      text: p.cacheableSystem,
      cache_control: { type: "ephemeral" },
    });
  }
  if (p.system) systemParts.push({ type: "text", text: p.system });

  const content: GatewayContentPart[] = [];
  for (const img of p.images ?? []) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
    });
  }
  content.push({ type: "text", text: p.prompt });

  const r = await gatewayChat({
    model: normalizeModel(p.model),
    system: systemParts.length > 0 ? systemParts : undefined,
    content,
    maxTokens: p.maxTokens,
  });

  const usage: LlmUsage = {
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
    cacheReadTokens: r.usage.cacheReadTokens,
  };
  return { text: r.text, usage, costUsd: r.usage.costUsd };
}

// ── HTTP services (Agent Price Researcher) ───────────────────────────────────

export type HttpServiceCallParams = {
  /** Cost-table lookup: provider "apr", model "research" | "quick_lookup". */
  provider: string;
  model: string;
  url: string;
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  /** Only billable requests log cost — polling GETs should pass billable: false. */
  billable?: boolean;
  op: string;
  batchId?: string | null;
  jobId?: string | null;
  timeoutMs?: number;
};

export type HttpServiceResult = {
  status: number;
  json: unknown;
  costUsd: number;
  durationMs: number;
};

/**
 * Call a request-billed HTTP service and log cost. Phase 4 wires the APR
 * submit/poll flow through this: the POST /research submit is billable,
 * the poll GETs are not.
 */
export async function callHttpService(
  p: HttpServiceCallParams
): Promise<HttpServiceResult> {
  const started = Date.now();
  const billable = p.billable ?? true;
  const rate = billable ? await getRate(p.provider, p.model) : null;
  const costUsd = rate?.perRequestUsd ?? 0;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), p.timeoutMs ?? 30_000);
    const resp = await fetch(p.url, {
      method: p.method ?? "GET",
      headers: {
        ...(p.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(p.headers ?? {}),
      },
      body: p.body !== undefined ? JSON.stringify(p.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const json = (await resp.json().catch(() => null)) as unknown;
    const durationMs = Date.now() - started;

    if (billable) {
      await logAiCall({
        op: p.op,
        batchId: p.batchId,
        jobId: p.jobId,
        category: "http_service",
        provider: p.provider,
        model: p.model,
        requestCount: 1,
        costUsd,
        durationMs,
        success: resp.ok,
        errorMessage: resp.ok ? undefined : `HTTP ${resp.status}`,
      });
    }
    return { status: resp.status, json, costUsd: billable ? costUsd : 0, durationMs };
  } catch (err) {
    if (billable) {
      await logAiCall({
        op: p.op,
        batchId: p.batchId,
        jobId: p.jobId,
        category: "http_service",
        provider: p.provider,
        model: p.model,
        requestCount: 1,
        costUsd: 0,
        durationMs: Date.now() - started,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}
