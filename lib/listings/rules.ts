// Listing writer rules (Phase LIST-2). Pure functions, no I/O — tested in
// rules.test.mts. Carries over the Nifty BIN extension's conventions:
//   - titles: 80 characters, no bin codes (NA123), "vintage" → "Vtg" only
//     when that is what makes it fit
//   - descriptions: plain text, Nifty's 1,500-character cap, and the first
//     ~1,000 characters must stand alone (Mercari / Depop cut off there)
//   - prices: nearest .87, $5.87 floor (RPPC $9.87, early cards $7.87),
//     postcards priced $20–$24 drop to $19.99 to stay on Standard Envelope,
//     Poshmark never below $15 (flat $2.95 fee under $15)
//   - shipping: Standard Envelope only for ESE-eligible categories at ≤ $20

import { ESE_MAX_PRICE, eseEligible } from "@/lib/enhance/ese";

// ── settings ────────────────────────────────────────────────────────────────

export const TIERS = ["simple", "general", "premium"] as const;
export type Tier = (typeof TIERS)[number];

export type WriterSettings = {
  /** OpenRouter model id (or gateway alias) per tier. */
  models: Record<Tier, string>;
  /** Model for the quick identify pass that picks the tier and guides. */
  identifyModel: string;
  /** Photos sent to the writer (the identify pass sees up to 3). */
  maxPhotos: number;
  /** Below this confidence the writer retries once, one tier up. */
  retryBelow: number;
  /** Lowest eBay price the writer may suggest. */
  floor: number;
  /** Poshmark's own floor (0 = off). */
  poshmarkFloor: number;
};

export const DEFAULT_WRITER_SETTINGS: WriterSettings = {
  models: {
    simple: "anthropic/claude-haiku-4.5",
    general: "anthropic/claude-sonnet-5",
    premium: "anthropic/claude-fable-5",
  },
  identifyModel: "anthropic/claude-haiku-4.5",
  maxPhotos: 6,
  retryBelow: 0.6,
  floor: 5.87,
  poshmarkFloor: 15,
};

const MODEL_RE = /^[a-z0-9][a-z0-9._:/-]{1,120}$/i;

export function parseWriterSettings(raw: unknown): WriterSettings {
  const d = DEFAULT_WRITER_SETTINGS;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const m = (r.models && typeof r.models === "object" ? r.models : {}) as Record<string, unknown>;
  const model = (v: unknown, fb: string) => (typeof v === "string" && MODEL_RE.test(v.trim()) ? v.trim() : fb);
  const num = (v: unknown, fb: number, lo: number, hi: number) => {
    const n = Number(v);
    return v !== null && v !== "" && Number.isFinite(n) && n >= lo && n <= hi ? n : fb;
  };
  return {
    models: {
      simple: model(m.simple, d.models.simple),
      general: model(m.general, d.models.general),
      premium: model(m.premium, d.models.premium),
    },
    identifyModel: model(r.identifyModel, d.identifyModel),
    maxPhotos: Math.round(num(r.maxPhotos, d.maxPhotos, 1, 12)),
    retryBelow: num(r.retryBelow, d.retryBelow, 0, 1),
    floor: num(r.floor, d.floor, 0.99, 1000),
    poshmarkFloor: num(r.poshmarkFloor, d.poshmarkFloor, 0, 1000),
  };
}

// ── JSON from model text ────────────────────────────────────────────────────

export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = String(text ?? "").replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(cleaned.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, n: number, max = 60): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : [];
const clamp01 = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
};
const money = (v: unknown): number | null => {
  const n = Number(typeof v === "string" ? v.replace(/[$,\s]/g, "") : v);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
};

// ── identify pass ───────────────────────────────────────────────────────────

export const KINDS = [
  "postcard", "photograph", "ephemera", "book", "magazine", "record", "artwork",
  "trading_card", "greeting_card", "map", "document", "other",
] as const;
export const CARD_TYPES = ["rppc", "early", "whiteborder", "linen", "chrome", "holiday", "other", "nonpostcard"] as const;

export type Identification = {
  identification: string;
  kind: (typeof KINDS)[number];
  cardType: (typeof CARD_TYPES)[number];
  keywords: string[];
  era: string;
  places: string[];
  signed: boolean;
  estValueUsd: number | null;
  difficulty: "simple" | "general" | "hard";
  confidence: number | null;
  notes: string;
};

export function parseIdentification(text: string): Identification | null {
  const j = extractJson(text);
  if (!j) return null;
  const ident = str(j.identification, 200);
  if (!ident) return null;
  const kind = (KINDS as readonly string[]).includes(String(j.kind)) ? (j.kind as Identification["kind"]) : "other";
  let cardType = (CARD_TYPES as readonly string[]).includes(String(j.card_type))
    ? (j.card_type as Identification["cardType"])
    : kind === "postcard" ? "other" : "nonpostcard";
  if (kind !== "postcard" && cardType !== "holiday") cardType = "nonpostcard";
  const diff = ["simple", "general", "hard"].includes(String(j.difficulty)) ? (j.difficulty as Identification["difficulty"]) : "general";
  return {
    identification: ident,
    kind,
    cardType,
    keywords: strList(j.keywords, 12),
    era: str(j.era, 60),
    places: strList(j.places, 6),
    signed: j.signed === true,
    estValueUsd: money(j.est_value_usd),
    difficulty: diff,
    confidence: clamp01(j.confidence),
    notes: str(j.notes, 400),
  };
}

/** Which model tier writes this item. Artwork, signed, valuable or hard
 *  items get the strongest model; common postcards and simple paper the
 *  inexpensive one; everything else the middle one. */
export function pickTier(id: Identification | null, facts: Record<string, unknown> = {}): { tier: Tier; reason: string } {
  if (!id) return { tier: "general", reason: "identify pass failed" };
  if (id.kind === "artwork") return { tier: "premium", reason: "artwork" };
  if (id.signed) return { tier: "premium", reason: "signed" };
  if (id.estValueUsd != null && id.estValueUsd >= 75) return { tier: "premium", reason: `est. value $${id.estValueUsd}` };
  if (id.difficulty === "hard") return { tier: "premium", reason: "hard to identify" };
  if (facts.needs_review === true) return { tier: "general", reason: "Scanroom flagged it for review" };
  const simpleKinds = new Set(["postcard", "greeting_card", "ephemera", "trading_card"]);
  if (
    simpleKinds.has(id.kind) &&
    id.difficulty === "simple" &&
    (id.estValueUsd == null || id.estValueUsd < 25) &&
    (id.confidence == null || id.confidence >= 0.7)
  ) {
    return { tier: "simple", reason: `common ${id.kind.replace("_", " ")}` };
  }
  return { tier: "general", reason: "general item" };
}

export function nextTier(t: Tier): Tier | null {
  const i = TIERS.indexOf(t);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
}

export function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIERS as readonly string[]).includes(v);
}

// ── Expert Guide sections ───────────────────────────────────────────────────

/** Headings worth sending to the writer (the extension's rewrite + pricing sets). */
const KEEP_HEADING =
  /titl|keyword|seo|search strateg|descript|listing|naming convention|hard rule|pitfall|multiply value|features that|identif|decision tree|dating|date it|pric|value|worth|\$|item\s*specific|condition|grad/i;

export type GuideText = { id: string; name: string; content: string };

function splitSections(content: string): Array<{ heading: string; body: string }> {
  const out: Array<{ heading: string; body: string }> = [];
  let cur = { heading: "", body: "" };
  for (const line of content.split(/\r?\n/)) {
    const m = /^#{1,3}\s+(.*)$/.exec(line);
    if (m) {
      if (cur.heading || cur.body.trim()) out.push(cur);
      cur = { heading: m[1].trim(), body: line + "\n" };
    } else {
      cur.body += line + "\n";
    }
  }
  if (cur.heading || cur.body.trim()) out.push(cur);
  return out;
}

/** The parts of each guide the writer needs, most specific guide first,
 *  within a character budget (spare budget passes to the next guide). A
 *  guide with no matching headings is sent from the top, truncated. */
export function guidePromptText(guides: GuideText[], totalBudget = 30_000, perGuide = 16_000): string {
  const parts: string[] = [];
  let left = totalBudget;
  guides.forEach((g) => {
    if (left <= 500) return;
    const cap = Math.min(perGuide, left);
    const sections = splitSections(g.content);
    const intro = sections[0] && !sections[0].heading ? sections[0].body : "";
    const kept = sections.filter((s) => s.heading && KEEP_HEADING.test(s.heading));
    let text = kept.length ? (intro.slice(0, 1500) + kept.map((s) => s.body).join("\n")).trim() : g.content.trim();
    if (text.length > cap) text = text.slice(0, cap).replace(/\n[^\n]*$/, "") + "\n[…guide truncated]";
    const block = `### EXPERT GUIDE: ${g.name} (${g.id})\n\n${text}`;
    parts.push(block);
    left -= block.length;
  });
  return parts.join("\n\n---\n\n");
}

// ── eBay categories (from Todd's own live listings) ─────────────────────────

export type CategoryOption = { id: string; path: string; count: number };

const CAT_STOP = new Set(["and", "the", "other", "of", "for", "vintage", "collectibles", "now", "pre", "post"]);
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((w) => w.replace(/s$/, ""))
    .filter((w) => w.length > 2 && !CAT_STOP.has(w));
}

/** The categories Todd already lists in that best fit the identified item. */
export function rankCategories(options: CategoryOption[], text: string, limit = 40): CategoryOption[] {
  const want = new Set(words(text));
  const scored = options.map((o) => {
    const w = words(o.path);
    const hits = w.filter((x) => want.has(x)).length;
    // Usage breaks ties and keeps common shelves in the list.
    return { o, s: hits * 10 + Math.log10(1 + o.count) };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.o);
}

export function cleanCategoryPath(p: string): string {
  return p.replace(/&amp;/g, "&").split(/\s*:\s*/).join(" > ");
}

// ── title / description cleanup ─────────────────────────────────────────────

export const TITLE_MAX = 80;
export const DESC_MAX = 1500;

const TITLE_LABEL = /^(?:[*_#`"'\s]*)(?:here(?:'s| is)\s+(?:the|your|a|an)\s+)?(?:new|revised|suggested|final)?\s*title\s*[*_`]*\s*[:\-–—]\s*/i;

export function cleanTitle(raw: string, binSku?: string | null): string {
  let t = String(raw ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] ?? "";
  t = t.replace(TITLE_LABEL, "").replace(/^["'`*_]+|["'`*_]+$/g, "");
  // Never let a bin code reach a title.
  t = t.replace(/[\s\-:|]*(?:SKU\s*[:#-]?\s*|#\s*)?[[(]?\s*\bNA\d{3}(?!\d)\b[\])]?[\s\-:|]*/gi, " ");
  if (binSku && binSku.trim().length >= 2) {
    const esc = binSku.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`[\\s\\-:|]*(?:SKU\\s*[:#-]?\\s*)?[\\[(]?\\s*\\b${esc}\\b\\s*[\\])]?`, "gi"), " ");
  }
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > TITLE_MAX) t = t.replace(/\bvintage\b/gi, "Vtg");
  if (t.length > TITLE_MAX) {
    const cut = t.slice(0, TITLE_MAX + 1);
    const sp = cut.lastIndexOf(" ");
    t = (sp > 40 ? cut.slice(0, sp) : t.slice(0, TITLE_MAX)).replace(/[\s,;:\-–—|]+$/, "");
  }
  return t;
}

const DESC_LABEL = /^(?:[*_#`"'\s]*)(?:here(?:'s| is)\s+(?:the|your|a|an)\s+)?(?:new|revised|suggested|final)?\s*description\s*[*_`]*\s*(?:[:\-–—]|\r?\n)\s*/i;

/** Plain text, at most DESC_MAX characters, cut at a sentence end if one
 *  falls after character 1,000. */
export function cleanDescription(raw: string): string {
  let d = String(raw ?? "").trim();
  d = d.replace(/^```(?:\w+)?\s*|\s*```$/g, "").replace(DESC_LABEL, "");
  d = d
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h\d)\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (d.length > DESC_MAX) {
    const cut = d.slice(0, DESC_MAX);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("\n"));
    d = (end > 1000 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" "))).trim();
  }
  return d;
}

// ── price + shipping ────────────────────────────────────────────────────────

/** Nearest price ending in .87 (the extension's roundToCents87). */
export function nearest87(p: number): number {
  return Math.max(0.87, Math.round(p - 0.87) + 0.87);
}

export type PriceInput = {
  suggested: number;
  cardType: string;
  isPostcard: boolean;
  floor: number;
  poshmarkFloor: number;
};

export type PriceResult = {
  price: number;
  venuePrices: Record<string, number> | null;
  notes: string[];
};

export function applyPriceRules(p: PriceInput): PriceResult {
  const notes: string[] = [];
  let floor = p.floor;
  if (p.cardType === "rppc") floor = Math.max(floor, 9.87);
  if (p.cardType === "early") floor = Math.max(floor, 7.87);
  let price = nearest87(p.suggested);
  if (price !== p.suggested) notes.push(`rounded $${p.suggested.toFixed(2)} → $${price.toFixed(2)}`);
  if (price < floor) {
    notes.push(`raised to the $${floor.toFixed(2)} floor`);
    price = floor;
  }
  if (p.isPostcard && price >= 20 && price <= 24) {
    notes.push("postcard at $20–$24 set to $19.99 to keep Standard Envelope shipping");
    price = 19.99;
  }
  let venuePrices: Record<string, number> | null = null;
  if (p.poshmarkFloor > 0 && price < p.poshmarkFloor) {
    venuePrices = { poshmark: Math.ceil(p.poshmarkFloor) };
    notes.push(`Poshmark at $${Math.ceil(p.poshmarkFloor)} (its fee is a flat $2.95 below that)`);
  }
  return { price: Math.round(price * 100) / 100, venuePrices, notes };
}

export type ShippingProfile = "envelope" | "calculated" | "media";

export function suggestShipping(i: {
  price: number;
  categoryPath: string | null;
  kind: string;
  weightOz: number | null;
}): { profile: ShippingProfile; reason: string } {
  const path = (i.categoryPath ?? "").toLowerCase();
  if (/^(books|music|movies)/.test(path) || ["book", "magazine", "record"].includes(i.kind)) {
    return { profile: "media", reason: "books & media" };
  }
  if (i.price <= ESE_MAX_PRICE && eseEligible(i.categoryPath)) {
    if (i.weightOz != null && i.weightOz > 3.5) return { profile: "calculated", reason: "over 3.5 oz" };
    return { profile: "envelope", reason: "envelope-eligible category, $20 or less" };
  }
  if (i.price > ESE_MAX_PRICE) return { profile: "calculated", reason: "over $20" };
  return { profile: "calculated", reason: "category isn't envelope-eligible" };
}

// ── writer output ───────────────────────────────────────────────────────────

export const CONDITIONS = ["New", "Like New", "Used", "Pre-owned - Good", "Pre-owned - Fair", "For parts or not working"];

export type WriteOutput = {
  title: string;
  description: string;
  condition: string;
  conditionNote: string;
  ebayCategoryId: string | null;
  ebayCategorySuggestion: string;
  itemSpecifics: Record<string, string | string[]>;
  price: number | null;
  priceLow: number | null;
  priceHigh: number | null;
  priceRationale: string;
  confidence: number | null;
  flags: string[];
};

export function parseWriteOutput(text: string, opts: { binSku?: string | null; categoryIds?: Set<string> } = {}):
  | { ok: true; value: WriteOutput }
  | { ok: false; error: string } {
  const j = extractJson(text);
  if (!j) return { ok: false, error: "The model's reply wasn't JSON" };
  const title = cleanTitle(str(j.title, 300), opts.binSku);
  if (title.length < 10) return { ok: false, error: "The model returned no usable title" };
  const description = cleanDescription(typeof j.description === "string" ? j.description : "");
  if (description.length < 40) return { ok: false, error: "The model returned no usable description" };
  const condRaw = str(j.condition, 60);
  const condition = CONDITIONS.find((c) => c.toLowerCase() === condRaw.toLowerCase()) ?? "Used";
  let catId = str(j.ebay_category_id, 20).replace(/\D/g, "") || null;
  if (catId && opts.categoryIds && !opts.categoryIds.has(catId)) catId = null;
  const specs: Record<string, string | string[]> = {};
  if (j.item_specifics && typeof j.item_specifics === "object" && !Array.isArray(j.item_specifics)) {
    for (const [k0, v] of Object.entries(j.item_specifics as Record<string, unknown>)) {
      const k = k0.trim().slice(0, 65);
      if (!k) continue;
      if (Array.isArray(v)) {
        const list = strList(v, 10, 65);
        if (list.length) specs[k] = list;
      } else {
        const val = str(v, 65);
        if (val && !/^(unknown|n\/?a|none|not specified)$/i.test(val)) specs[k] = val;
      }
      if (Object.keys(specs).length >= 30) break;
    }
  }
  return {
    ok: true,
    value: {
      title,
      description,
      condition,
      conditionNote: str(j.condition_note, 1000),
      ebayCategoryId: catId,
      ebayCategorySuggestion: str(j.ebay_category_suggestion, 300),
      itemSpecifics: specs,
      price: money(j.price),
      priceLow: money(j.price_low),
      priceHigh: money(j.price_high),
      priceRationale: str(j.price_rationale, 800),
      confidence: clamp01(j.confidence),
      flags: strList(j.flags, 8, 200),
    },
  };
}
