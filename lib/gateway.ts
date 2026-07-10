// AI Gateway client — all LLM traffic goes through Todd's Cloudflare
// Worker (ai-gateway), which holds the single OpenRouter key and the
// central model-routing table.
//
// Env (Vercel + .env.local):
//   AI_GATEWAY_URL    — e.g. https://ai-gateway.<subdomain>.workers.dev
//   AI_GATEWAY_TOKEN  — the gateway's APP_TOKEN
//
// Two exports:
//   gatewayChat()     — low-level OpenAI-format call (providers.ts uses this)
//   gatewayMessages() — drop-in for the Anthropic SDK's messages.create()
//                       subset this app used, so call sites keep their
//                       response-parsing code unchanged.

const APP_NAME = "found-in-alabama";

export type GatewayContentPart =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "image_url"; image_url: { url: string } };

export type GatewayChatParams = {
  /** OpenRouter id ("anthropic/claude-sonnet-5"), legacy bare name, or gateway alias. Empty = gateway default. */
  model?: string;
  /** System prompt: plain string, or parts (text parts may carry cache_control). */
  system?: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  /** User content: plain string or OpenAI content parts. */
  content: string | GatewayContentPart[];
  maxTokens: number;
  /** Extra body fields passed straight to OpenRouter (plugins, reasoning, ...). */
  extra?: Record<string, unknown>;
};

export type GatewayChatResult = {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    /** OpenRouter's actual billed cost in USD, when reported. */
    costUsd?: number;
  };
  /** The model that actually ran (x-resolved-model / response model). */
  model: string;
};

// Legacy bare model names (pre-gateway) -> OpenRouter ids. OpenRouter's
// Anthropic ids use dots for versions (claude-opus-4.8) and no date
// suffixes, so dashed/dated names need explicit mapping.
const LEGACY_MODEL_MAP: Record<string, string> = {
  "claude-sonnet-5": "anthropic/claude-sonnet-5",
  "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
  "claude-haiku-4-5": "anthropic/claude-haiku-4.5",
  "claude-opus-4-6": "anthropic/claude-opus-4.6",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
};

export function normalizeModel(m: string | undefined): string {
  const model = (m ?? "").trim();
  if (!model || model.includes("/")) return model;
  if (LEGACY_MODEL_MAP[model]) return LEGACY_MODEL_MAP[model];
  if (/^claude/i.test(model)) return "anthropic/" + model;
  if (/^(gpt|chatgpt|o[134])/i.test(model)) return "openai/" + model;
  if (/^gemini/i.test(model)) return "google/" + model;
  return model; // gateway alias or unknown — let the gateway resolve it
}

function gatewayEnv(): { url: string; token: string } {
  const url = process.env.AI_GATEWAY_URL?.replace(/\/+$/, "");
  const token = process.env.AI_GATEWAY_TOKEN;
  if (!url || !token) {
    throw new Error(
      "AI_GATEWAY_URL / AI_GATEWAY_TOKEN are not set. Add them to .env.local and Vercel env vars."
    );
  }
  return { url, token };
}

export async function gatewayChat(p: GatewayChatParams): Promise<GatewayChatResult> {
  const { url, token } = gatewayEnv();

  const messages: Array<Record<string, unknown>> = [];
  if (p.system) {
    messages.push({ role: "system", content: p.system });
  }
  messages.push({ role: "user", content: p.content });

  const body: Record<string, unknown> = {
    messages,
    max_tokens: p.maxTokens,
    // Ask OpenRouter to report actual billed cost in the usage block.
    usage: { include: true },
    ...(p.extra ?? {}),
  };
  const model = normalizeModel(p.model);
  if (model) body.model = model;

  const resp = await fetch(url + "/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-app": APP_NAME,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Gateway ${resp.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await resp.json()) as {
    error?: { message?: string };
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  if (data.error) {
    throw new Error(`Gateway: ${data.error.message ?? JSON.stringify(data.error)}`.slice(0, 300));
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    text,
    usage: {
      // prompt_tokens includes cached tokens; split them out so the
      // cheaper cache-read rate applies to the cached share (same
      // convention the old OpenAI path used).
      inputTokens: Math.max(0, (data.usage?.prompt_tokens ?? 0) - cached),
      outputTokens: data.usage?.completion_tokens ?? 0,
      cacheReadTokens: cached,
      costUsd: typeof data.usage?.cost === "number" ? data.usage.cost : undefined,
    },
    model: resp.headers.get("x-resolved-model") ?? data.model ?? model ?? "",
  };
}

// ── Anthropic-SDK-compatible shim ────────────────────────────────────────────
//
// Mirrors the messages.create() subset this app used: {model, max_tokens,
// system, messages:[{role:"user", content: string | blocks}]} in, and
// {content:[{type:"text",text}], usage:{input_tokens, output_tokens}} out.
// Existing response-parsing code keeps working without changes.

type AnthropicImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};
type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicUserContent = string | Array<AnthropicImageBlock | AnthropicTextBlock>;

export type GatewayMessagesParams = {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user"; content: AnthropicUserContent }>;
};

export type GatewayMessagesResult = {
  content: Array<{ type: "text"; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    /** OpenRouter's actual billed cost in USD, when reported. */
    cost_usd?: number;
  };
  model: string;
};

export async function gatewayMessages(
  p: GatewayMessagesParams
): Promise<GatewayMessagesResult> {
  const msg = p.messages[0];
  if (!msg) throw new Error("gatewayMessages: no messages provided");

  let content: string | GatewayContentPart[];
  if (typeof msg.content === "string") {
    content = msg.content;
  } else {
    content = msg.content.map((block): GatewayContentPart => {
      if (block.type === "image") {
        return {
          type: "image_url",
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        };
      }
      return { type: "text", text: block.text };
    });
  }

  const r = await gatewayChat({
    model: p.model,
    system: p.system,
    content,
    maxTokens: p.max_tokens,
  });

  return {
    content: [{ type: "text", text: r.text }],
    usage: {
      input_tokens: r.usage.inputTokens,
      output_tokens: r.usage.outputTokens,
      cache_read_input_tokens: r.usage.cacheReadTokens,
      cost_usd: r.usage.costUsd,
    },
    model: r.model,
  };
}
