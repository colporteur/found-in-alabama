// Tiny utility for fetching a public web page and converting it to plain
// text suitable for inclusion in a Claude prompt. Used by the draft
// generator when the user provides a "source URL" (an estate sale page,
// auction listing, etc.) to add narrative context.
//
// Defensive — failures (404, timeout, oversized response) return null
// instead of throwing, so a bad URL doesn't break draft generation.

const MAX_BYTES = 500_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_TEXT_CHARS = 6_000;

/**
 * Fetch the URL, strip HTML, return a plain-text excerpt suitable for
 * pasting into a Claude prompt. Returns null on any failure (with
 * console.warn for diagnostics).
 */
export async function fetchUrlAsText(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        // A real browser-ish UA so estate sale platforms don't block us.
        "User-Agent":
          "Mozilla/5.0 (compatible; FoundInAlabamaBot/1.0; +https://www.foundinalabama.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      console.warn(`[url-fetch] ${url} returned ${res.status}`);
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("application/xhtml")
    ) {
      console.warn(`[url-fetch] ${url} not HTML (${contentType})`);
      return null;
    }

    // Read up to MAX_BYTES of the response. Hard-cap so a giant page
    // can't blow up the function.
    const reader = res.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        chunks.push(value.slice(0, value.length - (total - MAX_BYTES)));
        break;
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const html = buf.toString("utf-8");

    const text = htmlToText(html).slice(0, MAX_TEXT_CHARS);
    return text || null;
  } catch (err) {
    console.warn(`[url-fetch] ${url} failed`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip scripts/styles, decode entities lightly, drop all tags, collapse
 * whitespace. Not perfect but good enough for narrative grounding.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
