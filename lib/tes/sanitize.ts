// Minimal HTML sanitizer for eBay listing descriptions rendered on TES
// product pages. The source is Todd's own listings (via Nifty), so this
// is defense-in-depth rather than hostile-input handling: strip anything
// executable or layout-hijacking, keep basic formatting.

const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|form|noscript)\b[\s\S]*?<\/\1\s*>/gi;
const DROP_SELF = /<(script|style|iframe|object|embed|form|link|meta|base|input|button|noscript)\b[^>]*\/?>/gi;
const DROP_EVENT_ATTRS = /\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const DROP_JS_URLS = /\s(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi;

export function sanitizeListingHtml(html: string): string {
  return html
    .replace(DROP_WITH_CONTENT, "")
    .replace(DROP_SELF, "")
    .replace(DROP_EVENT_ATTRS, "")
    .replace(DROP_JS_URLS, "");
}

/** Entity-decode + strip tags — for meta descriptions / JSON-LD. */
export function plainTextFromHtml(html: string, maxLen = 300): string {
  const text = html
    .replace(DROP_WITH_CONTENT, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}
