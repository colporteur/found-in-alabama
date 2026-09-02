// Supply-aware repricing (P5) — the live-listing side of the supply snapshot.
//
// Thousands of postcards were priced before the supply snapshot existed
// (Nifty v1.40 / gateway /v1/supply). This module rebuilds that signal for a
// listing that is ALREADY live and decides whether its price should move.
//
// The important asymmetry, and the reason this op exists at all: the reflex
// on a stale listing is to mark it down, but a SOLE-SUPPLIER stale listing is
// usually UNDERpriced — the buyer who wants it has nowhere else to go. So the
// primary action here is RAISE, and lowering only fires when a listing sits
// far above a genuinely crowded market.
//
// Query building mirrors Nifty content.js buildSupplyQuery(): publisher and
// process names are provenance, not identity, and a photographer credit left
// in the query turns a common card into a false "sole supplier".

export type SupplyBand = "sole" | "thin" | "crowded" | "adjacent" | "none";

export type SupplyStats = { n: number; min: number; median: number; max: number } | null;

export type SupplySnapshot = {
  q: string;
  q_used: string;
  loosened: boolean;
  total: number;
  counted: number;
  same: number;
  similar: number;
  other: number;
  band: SupplyBand;
  same_stats: SupplyStats;
  similar_stats: SupplyStats;
  all_stats: SupplyStats;
  cached?: boolean;
};

const STOP = new Set([
  "vintage", "vtg", "antique", "rare", "nice", "original", "lot", "set", "the", "a", "an",
  "of", "and", "for", "with", "in", "on", "to", "by", "from", "unposted", "posted", "unused",
  "used", "mint", "estate", "find", "collectible", "collectibles", "ephemera", "paper", "nm",
  "vg", "ex", "exc", "fine", "good", "grade", "graded",
]);
const FORMAT_RE =
  /^(rppc|postcard|postcards|photo|photograph|snapshot|print|cover|blotter|brochure|pamphlet|map|magazine|book|record|lp)$/i;
// Publisher / process names are provenance, not identity — the same view was
// printed by several houses and buyers search the subject.
const PUBLISHER_WORDS = new Set([
  "curteich", "curteichcolor", "teich", "tichnor", "dexter", "plastichrome", "petley",
  "mirro-krome", "mirrokrome", "kropp", "colourpicture", "metrocraft", "scenikrome", "koppel",
  "kodachrome", "chrome", "linen", "genuine", "natural", "color", "colorpicture", "dukane",
  "tichnorgloss", "lusterchrome", "sceniccolor", "photochrome", "phostint", "detroit",
  "valentine", "rotograph", "albertype", "tuck", "raphael", "oilette", "asheville", "ektachrome",
]);
const PUBLISHER_PHRASES = [
  /\bcurt\s+teich\b/i, /\bmike\s+roberts\b/i, /\bdexter\s+press\b/i, /\bl\.?\s*l\.?\s+cook\b/i,
  /\bdetroit\s+publishing\b/i, /\bpublishing\s+co\.?\b/i, /\bpub\.?\s+co\.?\b/i,
  /\bphoto\s+by\b.*$/i, /\bcolou?r\s+by\b.*$/i,
];

/** Town + subject + format, at most 7 identity tokens, format last. */
export function buildSupplyQuery(title: string): { q: string; category: string } {
  let raw = String(title || "").replace(/\(.*?\)/g, " ");
  for (const re of PUBLISHER_PHRASES) raw = raw.replace(re, " ");
  const toks = raw
    .replace(/[|/,;:!?"'“”‘’()[\]{}#*]+/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  // The format word can sit anywhere (often after the 7-token cut) — find it first.
  let format = "";
  for (const w0 of toks) {
    const lw = w0.replace(/^[-–—.]+|[-–—.]+$/g, "").toLowerCase();
    if (FORMAT_RE.test(lw)) { format = lw === "postcards" ? "postcard" : lw; break; }
    if (lw === "cabinet" || lw === "trade" || lw === "greeting") { format = lw + " card"; break; }
  }

  const keep: string[] = [];
  for (const w0 of toks) {
    const w = w0.replace(/^[-–—.]+|[-–—.]+$/g, "");
    if (!w) continue;
    const lw = w.toLowerCase();
    if (/^(vg|ex|nm|f|g|p|exc|mint)[+-]?$/i.test(w)) continue;                    // grades
    if (/^\d+x\d+$/i.test(w) || /^\d+(\.\d+)?["”]?x$/i.test(w)) continue;         // sizes
    // Serials (0B-H864, PE-14, C13193, 882-C) — but a bare year and a decade
    // token ("1950", "1950s", "50s") are identity, not a printer's code.
    if (/^[a-z]{0,3}-?\d+[a-z]*(-[a-z0-9]+)?$/i.test(w) && /\d/.test(w)
        && !/^\d{4}$/.test(w) && !/^\d{2,4}s$/i.test(w)) continue;
    if (FORMAT_RE.test(lw) || lw === "card" || lw === "cards" || lw === "post" || lw === "cabinet") continue;
    if (STOP.has(lw)) continue;
    if (PUBLISHER_WORDS.has(lw)) continue;
    if (lw.length < 2) continue;
    keep.push(w);
    if (keep.length >= 7) break;
  }
  const q = (keep.join(" ") + (format ? " " + format : "")).trim();
  const category = format === "postcard" || format === "rppc" ? "262042" : "";
  return { q, category };
}

/** GET the gateway's /v1/supply. Throws on a misconfigured or failing gateway. */
export async function fetchSupply(
  q: string,
  opts: { category?: string; excludeSeller?: string; limit?: number } = {}
): Promise<SupplySnapshot> {
  const url = process.env.AI_GATEWAY_URL?.replace(/\/+$/, "");
  const token = process.env.AI_GATEWAY_TOKEN;
  if (!url || !token) throw new Error("AI_GATEWAY_URL / AI_GATEWAY_TOKEN are not set");
  const params = new URLSearchParams({ q, limit: String(opts.limit ?? 50) });
  if (opts.category) params.set("category", opts.category);
  if (opts.excludeSeller) params.set("exclude_seller", opts.excludeSeller);
  const res = await fetch(`${url}/v1/supply?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`supply HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as SupplySnapshot;
}

export type RepriceConfig = {
  /** Compute and record the decision without calling ReviseItem. Default TRUE. */
  dryRun: boolean;
  /** A sole/adjacent listing at or under this price is a RAISE candidate. */
  raiseUnder: number;
  /** Only lower when the price exceeds the same-item median by this factor. */
  crowdedFactor: number;
  /** Never price below this. */
  floor: number;
  /** Cap on a single raise, as a multiple of the current price. */
  maxRaiseFactor: number;
  /** Only act on listings at least this many days old (0 = any). */
  minAgeDays: number;
  /** Round the new price to Todd's .87 ending. */
  round87: boolean;
  /** Seller name excluded from the comp set (his own live listings). */
  excludeSeller: string;
};

export const REPRICE_DEFAULTS: RepriceConfig = {
  dryRun: true,
  raiseUnder: 12,
  crowdedFactor: 1.25,
  floor: 5.87,
  maxRaiseFactor: 3,
  minAgeDays: 60,
  round87: true,
  excludeSeller: "yellowhammeryields",
};

export function parseRepriceConfig(cfg: Record<string, unknown>): RepriceConfig {
  const num = (k: keyof RepriceConfig, d: number) => {
    const v = Number(cfg[k]);
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return {
    dryRun: cfg.dryRun !== false,                       // must be opted OUT of
    raiseUnder: num("raiseUnder", REPRICE_DEFAULTS.raiseUnder),
    crowdedFactor: Math.max(1, num("crowdedFactor", REPRICE_DEFAULTS.crowdedFactor)),
    floor: num("floor", REPRICE_DEFAULTS.floor),
    maxRaiseFactor: Math.max(1, num("maxRaiseFactor", REPRICE_DEFAULTS.maxRaiseFactor)),
    minAgeDays: num("minAgeDays", REPRICE_DEFAULTS.minAgeDays),
    round87: cfg.round87 !== false,
    excludeSeller:
      typeof cfg.excludeSeller === "string" && cfg.excludeSeller.trim()
        ? cfg.excludeSeller.trim().toLowerCase()
        : REPRICE_DEFAULTS.excludeSeller,
  };
}

/** Todd's price convention: whole dollars ending .87. */
export function round87(v: number): number {
  return Math.max(0.87, Math.floor(v) + 0.87);
}

export type RepriceDecision = {
  action: "raise" | "lower" | "hold";
  newPrice: number | null;
  reason: string;
  anchor: number | null;
};

/**
 * Decide what a live listing's price should be, given its supply snapshot.
 *
 * RAISE  — band sole/none (nobody else is selling this) or adjacent (only
 *          similar items exist) AND the price is under raiseUnder. The anchor
 *          is the similar-item median, or the all-items median; with neither,
 *          there is no evidence and it holds.
 * LOWER  — band crowded AND the price is more than crowdedFactor x the
 *          same-item median. Target is the median itself, never below it:
 *          undercutting a crowded market is how the floor got here.
 * HOLD   — everything else, including thin markets (1-4 competitors), where
 *          the guidance is "do not undercut" and there is no case to move.
 */
export function decideReprice(
  price: number,
  snap: SupplySnapshot,
  cfg: RepriceConfig,
  ageDays: number | null
): RepriceDecision {
  if (cfg.minAgeDays > 0 && ageDays !== null && ageDays < cfg.minAgeDays) {
    return { action: "hold", newPrice: null, anchor: null,
      reason: `Listed ${Math.round(ageDays)}d ago — under the ${cfg.minAgeDays}d age gate` };
  }

  if (snap.band === "crowded") {
    const median = snap.same_stats?.median ?? null;
    if (median === null) {
      return { action: "hold", newPrice: null, anchor: null, reason: "Crowded but no same-item median" };
    }
    if (price <= median * cfg.crowdedFactor) {
      return { action: "hold", newPrice: null, anchor: median,
        reason: `Crowded (${snap.same} same) but $${price.toFixed(2)} is within ${cfg.crowdedFactor}x the $${median.toFixed(2)} median` };
    }
    let target = Math.max(median, cfg.floor);
    if (cfg.round87) target = round87(target);
    if (target >= price) {
      return { action: "hold", newPrice: null, anchor: median, reason: "Median target is not below the current price" };
    }
    return { action: "lower", newPrice: target, anchor: median,
      reason: `Crowded: ${snap.same} same-item listings, median $${median.toFixed(2)}; asking $${price.toFixed(2)} is over ${cfg.crowdedFactor}x it` };
  }

  const soleish = snap.band === "sole" || snap.band === "none" || snap.band === "adjacent";
  if (!soleish) {
    return { action: "hold", newPrice: null, anchor: null,
      reason: `Band ${snap.band} — thin markets hold (do not undercut, no case to raise)` };
  }
  if (price > cfg.raiseUnder) {
    return { action: "hold", newPrice: null, anchor: null,
      reason: `Band ${snap.band} but $${price.toFixed(2)} is already over the $${cfg.raiseUnder.toFixed(2)} raise gate` };
  }
  const anchor = snap.similar_stats?.median ?? snap.all_stats?.median ?? null;
  if (anchor === null) {
    return { action: "hold", newPrice: null, anchor: null,
      reason: `Band ${snap.band} but no similar-item median to anchor a raise` };
  }
  let target = Math.max(anchor, price, cfg.floor);
  const cap = price * cfg.maxRaiseFactor;
  if (target > cap) target = cap;
  if (cfg.round87) target = round87(target);
  if (target <= price + 0.005) {
    return { action: "hold", newPrice: null, anchor,
      reason: `Band ${snap.band}; anchor $${anchor.toFixed(2)} is not above the current $${price.toFixed(2)}` };
  }
  return { action: "raise", newPrice: target, anchor,
    reason: `${snap.band === "adjacent" ? "Adjacent" : "Sole supplier"}: ${snap.same} same / ${snap.similar} similar active; anchor median $${anchor.toFixed(2)} vs asking $${price.toFixed(2)}` };
}
