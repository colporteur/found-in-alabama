// eBay Standard Envelope (ESE) eligibility + triage for LIVE listings.
//
// Ported from the Nifty BIN extension (content.js v1.34/v1.44: eseNormPath,
// eseEligible, ESE_GROUP_RULES) so the site audits the same way the draft
// guard does. Pure functions, no I/O — see ese.test.mts.
//
// The eligible list is `ese-categories.json`, built from eBay's
// ebaystandardenvelopeeligiblelist.xlsx (Aug 2026). A category is eligible
// when it equals a listed path or sits anywhere beneath one. Replace the
// JSON (same file as the extension ships) to update the list.
//
// Triage rule (Todd, 2026-09-09):
//   envelope policy + INELIGIBLE category + title reads as a card type
//     + price ≤ ESE_MAX_PRICE      → "recategorize" (keep envelope, fix the
//                                     eBay category — cheap shipping sells)
//   envelope policy + INELIGIBLE category, anything else
//                                  → "reship" (Calculated Shipping, 4oz)
//   envelope policy + eligible     → "ok"
//   not on an envelope policy      → "n/a"

import raw from "./ese-categories.json";

/** eBay only allows Standard Envelope up to this item price. */
export const ESE_MAX_PRICE = 20;

export type EseGroup =
  | "Postcards"
  | "Greeting Cards"
  | "Stamps"
  | "Coins"
  | "Trading Cards"
  | "Seeds"
  | "";

export type EseAction = "recategorize" | "reship" | "ok" | "n/a";

export interface EsePath {
  g: string;
  p: string;
  /** normalized form, segments joined with "|" */
  n: string;
}

/** Normalize "A > B & C" / "A:B & C" → "a|b and c". */
export function eseNormPath(s: string | null | undefined): string {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[‘’']/g, "")
    .split(/\s*[>:]\s*/)
    .map((seg) => seg.replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean)
    .join("|");
}

let listCache: EsePath[] | null = null;

/** The eligible list with normalized paths (cached). */
export function eseList(): EsePath[] {
  if (listCache) return listCache;
  const paths = ((raw as { paths?: { g?: string; p?: string }[] }).paths ?? [])
    .map((o) => ({ g: String(o.g || ""), p: String(o.p || ""), n: eseNormPath(o.p) }))
    .filter((o) => o.n);
  listCache = paths;
  return paths;
}

/** True when `path` equals an eligible path or sits beneath one. */
export function eseEligible(path: string | null | undefined, list: EsePath[] = eseList()): boolean {
  const n = eseNormPath(path);
  if (!n) return false;
  return list.some((o) => n === o.n || n.startsWith(o.n + "|"));
}

// Keyword → list group. Order matters: the first hit wins.
export const ESE_GROUP_RULES: { re: RegExp; group: Exclude<EseGroup, ""> }[] = [
  { re: /\bpost\s?cards?\b|\bpostcard\b|\bview card\b|\bRPPC\b|\breal photo\b/i, group: "Postcards" },
  { re: /\bgreeting card|\bchristmas card|\bvalentine|\bbirthday card|\bholiday card|\beaster card|\bgift tag/i, group: "Greeting Cards" },
  { re: /\bstamps?\b|\bphilatel|\bfirst day cover|\bFDC\b|\bpostal cover|\bcinderella/i, group: "Stamps" },
  { re: /\bcoins?\b|\btokens?\b|\bbanknote|\bpaper money|\bcurrency\b|\bmedal\b|\bexonumia|\bwooden nickel|\bscrip\b|\bpenny\b|\bpennies\b|\bwheat cents?\b|\bindian head\b|\bbuffalo nickel|\bmercury dime|\bhalf dollar|\bsilver dollar|\bmorgan dollar|\bpeace dollar/i, group: "Coins" },
  { re: /\btrading cards?\b|\bTCG\b|\bCCG\b|\bpokemon|\bmagic the gathering|\bbaseball cards?\b|\bfootball cards?\b|\bbasketball cards?\b|\btrade cards?\b|\bsports? cards?\b/i, group: "Trading Cards" },
  { re: /\bseeds?\b|\bbulbs?\b|\bseedling/i, group: "Seeds" },
];

/** Card-type group the title (then description) reads as, or "". Title wins. */
export function eseCardGroup(title: string | null | undefined, description?: string | null): EseGroup {
  const t = String(title || "");
  for (const r of ESE_GROUP_RULES) if (r.re.test(t)) return r.group;
  const d = String(description || "").slice(0, 300);
  for (const r of ESE_GROUP_RULES) if (r.re.test(d)) return r.group;
  return "";
}

/**
 * Does this listing ship on an eBay Standard Envelope policy? Keyed on the
 * business-policy NAME first (Todd's reads "Very Small and Paper under 3.5 oz
 * (eBay Standard Envelope)"), then on the shipping service codes eBay
 * returns (the ESE service code contains "StandardEnvelope").
 */
export function isEnvelopeShipping(
  profileName: string | null | undefined,
  services?: string[] | null
): boolean {
  const name = String(profileName || "");
  if (/standard\s*envelope|very small and paper|\benvelope\b/i.test(name)) return true;
  for (const s of services ?? []) {
    if (/standard\s*envelope|StandardEnvelope/i.test(String(s))) return true;
  }
  return false;
}

export interface EseTriageInput {
  title: string;
  description?: string | null;
  /** eBay primary category path, ":" or ">" separated. */
  siteCategoryName: string | null;
  shippingProfileName: string | null;
  shippingServices?: string[] | null;
  price: number | string | null;
}

export interface EseTriage {
  envelope: boolean;
  eligible: boolean;
  group: EseGroup;
  price: number | null;
  action: EseAction;
  reason: string;
}

export function triageListing(l: EseTriageInput, list: EsePath[] = eseList()): EseTriage {
  const envelope = isEnvelopeShipping(l.shippingProfileName, l.shippingServices);
  const eligible = eseEligible(l.siteCategoryName, list);
  const group = eseCardGroup(l.title, l.description);
  const priceNum = l.price == null || l.price === "" ? null : Number(l.price);
  const price = priceNum != null && Number.isFinite(priceNum) ? priceNum : null;

  if (!envelope) {
    return { envelope, eligible, group, price, action: "n/a", reason: "not on an envelope policy" };
  }
  if (eligible) {
    return { envelope, eligible, group, price, action: "ok", reason: "category is Standard-Envelope eligible" };
  }
  if (price != null && price > ESE_MAX_PRICE) {
    return {
      envelope, eligible, group, price, action: "reship",
      reason: `price $${price.toFixed(2)} is over the $${ESE_MAX_PRICE} envelope cap`,
    };
  }
  if (group) {
    return {
      envelope, eligible, group, price, action: "recategorize",
      reason: `title reads as ${group}; move to an eligible ${group} category and keep envelope`,
    };
  }
  return {
    envelope, eligible, group, price, action: "reship",
    reason: "not a card-type item; switch to Calculated Shipping (4oz)",
  };
}
