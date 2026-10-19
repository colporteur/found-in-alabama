// Site search (SEARCH-1): text → meaning vectors through Todd's AI gateway
// (/v1/embeddings → OpenRouter, openai/text-embedding-3-small at 512
// dimensions). Used for "meaning" search: "old train stuff" finds
// railroadiana with no shared words. About $0.02 per million tokens — the
// whole catalog is a few cents; each search is a fraction of a cent.

export const EMBED_MODEL = "openai/text-embedding-3-small";
export const EMBED_DIMS = 512;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const url = process.env.AI_GATEWAY_URL?.replace(/\/+$/, "");
  const token = process.env.AI_GATEWAY_TOKEN;
  if (!url || !token) throw new Error("AI_GATEWAY_URL / AI_GATEWAY_TOKEN are not set");
  if (!texts.length) return [];
  const resp = await fetch(url + "/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-app": "fia-search" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, dimensions: EMBED_DIMS }),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    throw new Error(
      resp.status === 404
        ? "The AI gateway has no /v1/embeddings route yet — deploy the updated worker (ai-gateway\\deploy.bat)."
        : `Gateway embeddings ${resp.status}: ${detail}`
    );
  }
  const data = (await resp.json()) as { data?: Array<{ embedding: number[]; index: number }>; error?: { message?: string } };
  if (data.error || !Array.isArray(data.data)) throw new Error(`Embeddings: ${data.error?.message ?? "no data"}`);
  const out: number[][] = new Array(texts.length);
  for (const d of data.data) out[d.index] = d.embedding;
  if (out.some((v) => !Array.isArray(v) || v.length !== EMBED_DIMS)) throw new Error("Embeddings came back the wrong size");
  return out;
}

/** pgvector literal: [0.1,0.2,…] */
export function vectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;
}

// A small per-instance cache so repeat searches don't re-embed.
const cache = new Map<string, number[]>();
export async function embedQuery(text: string): Promise<number[] | null> {
  const key = text.trim().toLowerCase().slice(0, 200);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit) return hit;
  const [v] = await embedTexts([key]);
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  cache.set(key, v);
  return v;
}
