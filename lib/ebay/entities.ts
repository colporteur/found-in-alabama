// Tiny XML-entity decoder. We disabled fast-xml-parser's entity processing
// (because eBay responses commonly exceed its 1000-entity safety limit), so
// strings parsed out of the API still contain things like "&amp;" instead
// of "&". Decode just before display or before sending to Claude.

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
};

export function decodeEntities(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITY_MAP[m] ?? m);
}
