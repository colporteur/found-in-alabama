// Tiny XML-entity decoder. We disabled fast-xml-parser's entity processing
// (because eBay responses commonly exceed its 1000-entity safety limit), so
// strings parsed out of the API still contain things like "&amp;" instead
// of "&". Decode just before display or before sending to Claude.
//
// Decoding loops (max 3 passes) because double-encoded strings occur in the
// wild — "&amp;apos;" needs two passes to become "'". Also handles numeric
// character references (&#8217; / &#x2019;).

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeOnce(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : _;
    })
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITY_MAP[m] ?? m);
}

export function decodeEntities(s: string | null | undefined): string {
  if (!s) return "";
  let out = s;
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}
