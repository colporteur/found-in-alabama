// Multi-provider AI abstraction for the Expert Enhance pipeline.
//
// Two categories (locked design decision #2):
//   callLlm()        — Claude / OpenAI / Gemini, token-billed
//   callHttpService()— request-billed HTTP services (Agent Price Researcher)
//
// Both log to ai_call_log with cost computed at call time (decision #3).
// Anthropic goes through the SDK we already ship; OpenAI and Gemini use
// direct fetch (same pattern as Resend — no new dependencies).
//
// Prompt caching (decision #7): pass `cacheableSystem` for the large
// stable prefix (an expert guide); `system` is the small per-op suffix.
// Only Anthropic honors it explicitly; OpenAI/Gemini cache automatically.

import { getClaude } from "@/lib/claude";
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
    let out: { text: string; usage: LlmUsage };
    if (p.provider === "anthropic") out = await callAnthropic(p);
    else if (p.provider === "openai") out = await callOpenAi(p);
    else out = await callGemini(p);

    const durationMs = Date.now() - started;
    const costUsd = computeLlmCost(rate, out.usage);
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

// ── Anthropic ────────────────────────────────────────────────────────────────

async function callAnthropic(p: LlmCallParams) {
  const client = getClaude();

  const system: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }> = [];
  if (p.cacheableSystem) {
    system.push({
      type: "text",
      text: p.cacheableSystem,
      cache_control: { type: "ephemeral" },
    });
  }
  if (p.system) system.push({ type: "text", text: p.system });

  const content: Array<Record<string, unknown>> = [];
  for (const img of p.images ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.base64 },
    });
  }
  content.push({ type: "text", text: p.prompt });

  const resp = await client.messages.create({
    model: p.model,
    max_tokens: p.maxTokens,
    ...(system.length > 0 ? { system: system as never } : {}),
    messages: [{ role: "user", content: content as never }],
  });

  const text = resp.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
  const u = resp.usage as unknown as Record<string, number | undefined>;
  const usage: LlmUsage = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  return { text, usage };
}

// ── OpenAI (direct fetch, chat completions) ──────────────────────────────────

async function callOpenAi(p: LlmCallParams) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env.local and Vercel env vars.");
  }

  const userContent: Array<Record<string, unknown>> = [];
  for (const img of p.images ?? []) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
    });
  }
  userContent.push({ type: "text", text: p.prompt });

  const systemText = [p.cacheableSystem, p.system].filter(Boolean).join("\n\n");
  const messages: Array<Record<string, unknown>> = [];
  if (systemText) messages.push({ role: "system", content: systemText });
  messages.push({ role: "user", content: userContent });

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: p.model,
      max_completion_tokens: p.maxTokens,
      messages,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const usage: LlmUsage = {
    // OpenAI's prompt_tokens INCLUDES cached tokens; split them out so
    // the cheaper cache-read rate applies to the cached share.
    inputTokens: Math.max(0, (data.usage?.prompt_tokens ?? 0) - cached),
    outputTokens: data.usage?.completion_tokens ?? 0,
    cacheReadTokens: cached,
  };
  return { text, usage };
}

// ── Gemini (direct fetch, generateContent) ───────────────────────────────────

async function callGemini(p: LlmCallParams) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env.local and Vercel env vars.");
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const img of p.images ?? []) {
    parts.push({ inline_data: { mime_type: img.mediaType, data: img.base64 } });
  }
  parts.push({ text: p.prompt });

  const systemText = [p.cacheableSystem, p.system].filter(Boolean).join("\n\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    p.model
  )}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(systemText
        ? { system_instruction: { parts: [{ text: systemText }] } }
        : {}),
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: p.maxTokens },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      cachedContentTokenCount?: number;
    };
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((x) => x.text ?? "").join("") ?? "";
  const usage: LlmUsage = {
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    cacheReadTokens: data.usageMetadata?.cachedContentTokenCount ?? 0,
  };
  return { text, usage };
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
