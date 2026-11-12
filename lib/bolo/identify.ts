// BOLO photo → entry: the prompt and the reply parser. Pure (no I/O) so it
// can be tested; the model call itself lives in lib/bolo/store.ts.

import type { BoloCategory, BoloItem } from "./discontinued";

export const BOLO_CATEGORIES: BoloCategory[] = [
  "Cleaners & polish",
  "Air fresheners",
  "Bar soap",
  "Hair care",
  "Fragrance",
  "Other",
  "Traps",
];

export type BoloStatus = "discontinued" | "still_sold" | "unsure";

export type BoloIdentified = Omit<BoloItem, "id" | "img"> & {
  status: BoloStatus;
  confidence: number;
};

export const BOLO_IDENTIFY_SYSTEM = `You help a reseller ("Found in Alabama") keep a BOLO list of DISCONTINUED household, cleaning, personal-care and beauty products that resell above retail on eBay once they leave store shelves.

You get one photo (usually taken in a store aisle, thrift store or estate sale) and maybe a short note from the reseller. Identify the exact product, then use WEB SEARCH to check:
1. Is it discontinued? Look at the maker's site, big retailers (Walmart, Target, Amazon, Home Depot), and news. Retailers listing it as in stock = still sold.
2. What does it bring on eBay? Prefer SOLD/completed prices. If you only find active listings, those are ASKING prices — say so. Note the unit (single, 3-pack, case).

Be honest. Never invent a sale price, a URL or a discontinuation. If you can't confirm a price, use "Check comps". If you can't read the label, say what you can see and lower the confidence.

Return ONLY this JSON object (no code fences, no commentary):
{
  "name": "Brand + product + variant/scent + size, as printed, e.g. \\"Pledge Clean It Multi-Surface, Fresh Citrus 16 oz\\"",
  "category": "one of: Cleaners & polish | Air fresheners | Bar soap | Hair care | Fragrance | Other",
  "query": "4-8 word eBay search that finds THIS product (brand, line, variant, size; no words like vintage/rare/discontinued)",
  "comp": "short price text, e.g. \\"$49.99 / 3-pack\\" or \\"$25–$40\\" or \\"Check comps\\"",
  "kind": "sold | asking | retail",
  "status": "discontinued | still_sold | unsure",
  "note": "one or two short sentences for the shelf: what to look for (packaging, size, old vs new label), and any caveat (aerosol = ground shipping, reformulated, comes back seasonally)",
  "source": "one URL that backs the price or the discontinuation, or empty string",
  "confidence": 0.0
}
"kind" is "retail" only when it is still sold in stores and you are giving the store price.`;

export function boloUserText(hint: string | null): string {
  return [
    "Photo: the product as found.",
    hint ? `Reseller's note: ${hint}` : "No note from the reseller.",
    "Identify it, check whether it's discontinued, and find what it brings on eBay.",
  ].join("\n");
}

function jsonBlock(text: string): Record<string, unknown> | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Parse the model's reply into a BOLO entry. Null if it can't be read. */
export function parseBoloReply(text: string): BoloIdentified | null {
  const j = jsonBlock(text);
  if (!j) return null;
  const name = str(j.name, 140);
  if (!name) return null;

  const statusRaw = str(j.status, 20).toLowerCase().replace(/[\s-]/g, "_");
  const status: BoloStatus =
    statusRaw === "discontinued" || statusRaw === "still_sold" ? statusRaw : "unsure";

  const catRaw = str(j.category, 40).toLowerCase();
  let category: BoloCategory = BOLO_CATEGORIES.find((c) => c.toLowerCase() === catRaw) ?? "Other";
  // Still on shelves → it's a trap, not a BOLO, whatever the model filed it under.
  if (status === "still_sold") category = "Traps";

  const kindRaw = str(j.kind, 10).toLowerCase();
  const kind: BoloItem["kind"] =
    status === "still_sold" ? "retail" : kindRaw === "sold" || kindRaw === "retail" ? (kindRaw as "sold" | "retail") : "asking";

  const query = str(j.query, 100) || name.slice(0, 100);
  const comp = str(j.comp, 60) || "Check comps";
  const source = str(j.source, 500);
  const confNum = Number(j.confidence);
  const confidence = Number.isFinite(confNum) ? Math.min(1, Math.max(0, confNum)) : 0.5;

  let note = str(j.note, 400);
  if (status === "unsure") note = `Not confirmed discontinued — check before buying deep.${note ? " " + note : ""}`;

  return {
    name,
    category,
    query,
    comp,
    kind,
    note: note || undefined,
    source: /^https?:\/\//i.test(source) ? source : undefined,
    status,
    confidence,
  };
}
