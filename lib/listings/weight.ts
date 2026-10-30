// Shipping weight for a draft (Todd, Oct 9): as automatic as possible,
// rounding UP — a little over is fine, under isn't.
//   1. A weight Todd gave (PhotoXfer folder name "…_2lb", or typed on the
//      draft) always wins.
//   2. Postcards → 1 oz (the postcard / 1 oz card profile).
//   3. Booklets, magazines, books, catalogs, programs → 1 lb, Media Mail.
//   4. Other paper (Scanroom scans) → 4, 8 or 12 oz by size.
//   5. Anything else (objects) → no guess; the template's weight stays and
//      the draft is flagged "weigh it".
// Pure; tested in weight.test.mts.

import { pieceCount } from "@/lib/shipping/mail";

export type WeightSource = "given" | "assumed" | "none";

export type WeightPlan = {
  oz: number | null;
  source: WeightSource;
  reason: string;
  /** Shipping profile this weight implies, when it decides one. */
  profile: "envelope" | "calculated" | "media" | null;
  /** SHIP-2: the piece fits an eBay Standard Envelope (≤ 6×11¼ in, flat
   *  paper); null = size unknown. The 4/8/12 oz weights are a rigid mailer
   *  — in an envelope it weighs about 1 oz (see suggestShipping). */
  envelopeFit?: boolean | null;
};

/** Card lots this size or bigger ship calculated, never Standard Envelope. */
export const CARD_LOT_MIN = 5;

/** Standard formats that always fit a Standard Envelope. */
const ENVELOPE_KINDS = new Set(["postcard", "trading_card", "greeting_card"]);

const PAPER_KINDS = new Set(["ephemera", "photograph", "document", "map", "greeting_card", "trading_card", "artwork"]);
const BOOKLET_RE = /\b(booklets?|magazines?|catalog(ue)?s?|pamphlets?|programs?|yearbooks?|annuals?|manuals?|comics?|books?|hymnals?|almanacs?|directory|directories)\b/i;

/** "8.6x2.4in", "8.6x11+in", "6 x 9" → [w, h] in inches. */
export function parseSize(s: string | null | undefined): [number, number] | null {
  const m = String(s ?? "").match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > 0 && b > 0 ? [Math.max(a, b), Math.min(a, b)] : null;
}

export function planWeight(i: {
  givenOz: number | null;
  kind: string | null;
  title: string | null;
  identification?: string | null;
  sizeInches: string | null;
  source: string | null;
  /** How many pieces (cards) — the "Number of Cards" specific or a lot's
   *  piece count; falls back to the title ("Lot of 14"). */
  pieces?: number | null;
}): WeightPlan {
  if (i.givenOz != null && i.givenOz > 0) {
    return { oz: i.givenOz, source: "given", reason: "weight given at intake or by hand", profile: null };
  }
  const kind = (i.kind ?? "").toLowerCase();
  const text = `${i.title ?? ""} ${i.identification ?? ""}`;
  // eBay Standard Envelope piece limits: 3 postcards, 24 raw cards.
  const pieces = i.pieces != null && i.pieces > 0 ? Math.floor(i.pieces) : pieceCount(i.title ?? "");
  // Card lots (Todd, Oct 30): 5 or more cards go calculated in a mailer, not
  // Standard Envelope — 4 oz up to 15 cards, 8 oz up to 40, 12 oz beyond.
  if (kind === "trading_card" && pieces >= CARD_LOT_MIN) {
    const oz = pieces <= 15 ? 4 : pieces <= 40 ? 8 : 12;
    return { oz, source: "assumed", reason: `card lot of ${pieces}: ${oz} oz mailer, calculated shipping`, profile: "calculated", envelopeFit: false };
  }
  if (kind === "postcard" && pieces <= 3) return { oz: 1, source: "assumed", reason: "postcard", profile: "envelope", envelopeFit: true };
  if (kind === "book" || kind === "magazine" || BOOKLET_RE.test(text)) {
    return { oz: 16, source: "assumed", reason: "booklet / magazine / book: 1 lb Media Mail", profile: "media" };
  }
  const size = parseSize(i.sizeInches);
  // Scanroom only scans flat paper, so its items count as paper unless the
  // identification says it's an object or a record.
  const paper = PAPER_KINDS.has(kind) || kind === "postcard" || (i.source === "scanroom" && kind !== "other" && kind !== "record");
  if (paper) {
    const [long, short] = size ?? [0, 0];
    const tooMany = pieces > (kind === "trading_card" ? 24 : kind === "postcard" ? 3 : 5);
    const envelopeFit = tooMany ? false : size ? long <= 11.25 && short <= 6 : ENVELOPE_KINDS.has(kind) ? true : null;
    const plan = paperWeight(size, long, short);
    return { ...plan, envelopeFit };
  }
  return { oz: null, source: "none", reason: "not paper — weigh it", profile: null };
}

/** Rigid-mailer weight for flat paper, by size. */
function paperWeight(size: [number, number] | null, long: number, short: number): WeightPlan {
  if (size && long <= 9 && short <= 6) return { oz: 4, source: "assumed", reason: `paper up to 6×9 in (${long}×${short})`, profile: "calculated" };
  if (size && long <= 12.5 && short <= 9.5) return { oz: 8, source: "assumed", reason: `paper up to 9×12 in (${long}×${short})`, profile: "calculated" };
  return { oz: 12, source: "assumed", reason: size ? `large paper (${long}×${short} in)` : "paper, size unknown", profile: "calculated" };
}

/** Pure: a draft's card count — the "Number of Cards" specific, else the
 *  number of pieces combined into its lot; null when neither is known. */
export function cardCount(specifics: Record<string, string | string[]> | null | undefined, aiMeta: unknown): number | null {
  const v = specifics?.["Number of Cards"];
  const n = parseInt(String(Array.isArray(v) ? v[0] : v ?? "").replace(/[^0-9]/g, ""), 10);
  if (Number.isFinite(n) && n > 0) return n;
  const parts = ((aiMeta ?? {}) as { lot?: { parts?: unknown[] } }).lot?.parts;
  return Array.isArray(parts) && parts.length ? parts.length : null;
}

/** 20 oz → { lb: 1, oz: 4 } (Nifty's "Package weight" is lb + oz). */
export function lbOz(totalOz: number): { lb: number; oz: number } {
  const t = Math.ceil(totalOz * 10) / 10;
  const lb = Math.floor(t / 16);
  return { lb, oz: Math.round((t - lb * 16) * 10) / 10 };
}
