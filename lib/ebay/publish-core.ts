// Phase 3e — publish an approved draft straight to eBay: the pure parts.
// Tested in publish-core.test.mts. I/O lives in publish.ts.

/** Shipping kind on the draft (listing_drafts.shipping_profile). */
export type ShipKind = "envelope" | "media" | "calculated";

export function shipKind(profile: string | null | undefined): ShipKind {
  const p = (profile ?? "").toLowerCase();
  if (p === "envelope") return "envelope";
  if (p === "media") return "media";
  return "calculated";
}

/** Which of Todd's eBay shipping policies (by name) fits each kind. The
 *  newest listing using a matching policy is the reference listing. */
export function policyMatches(kind: ShipKind, policyName: string | null | undefined): boolean {
  const n = (policyName ?? "").toLowerCase().replace(/&amp;/g, "&");
  if (kind === "envelope") return /standard envelope/.test(n) && !/free/.test(n);
  if (kind === "media") return /media mail/.test(n);
  return /calculated/.test(n);
}

/** eBay condition ids to try, best first, for FIA's condition words. */
const CONDITION_PREFS: Record<string, string[]> = {
  new: ["1000", "1500", "1750", "2750", "3000"],
  "like new": ["2750", "1500", "3000", "4000"],
  used: ["3000", "4000", "5000"],
  "pre-owned - good": ["5000", "4000", "3000"],
  "pre-owned - fair": ["6000", "5000", "3000"],
  "for parts or not working": ["7000", "6000", "3000"],
};

/** Pick the eBay ConditionID: the first preferred id the category allows;
 *  with no list from eBay, the reference listing's id or Used (3000). */
export function pickConditionId(condition: string | null | undefined, allowed: string[] | null, fallback: string | null): string {
  const prefs = CONDITION_PREFS[(condition ?? "used").toLowerCase().trim()] ?? CONDITION_PREFS.used;
  if (allowed && allowed.length) {
    const hit = prefs.find((p) => allowed.includes(p));
    if (hit) return hit;
    return allowed.includes("3000") ? "3000" : allowed[0];
  }
  return fallback ?? "3000";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** FIA's plain-text description → eBay HTML: paragraphs joined the way
 *  Nifty does it (<br/><br/>), single line breaks kept. */
export function descriptionHtml(text: string): string {
  return String(text ?? "")
    .trim()
    .split(/\n\s*\n/)
    .map((p) => esc(p.trim()).replace(/\n/g, "<br/>"))
    .filter(Boolean)
    .join("<br/><br/>");
}

/** eBay's UUID field (32 hex chars) from the draft id: eBay refuses a second
 *  listing with the same UUID, so a double press can't list twice. */
export function draftUuid(draftId: string): string {
  const hex = draftId.replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (hex.length !== 32) throw new Error("Draft id isn't a UUID");
  return hex;
}

export function lbOz(weightOz: number): { major: number; minor: number } {
  const t = Math.ceil(weightOz * 10) / 10;
  const major = Math.floor(t / 16);
  return { major, minor: Math.ceil(t - major * 16) };
}

export type Reference = {
  itemId: string;
  paymentProfileId: string | null;
  returnProfileId: string | null;
  shippingProfileId: string;
  shippingProfileName: string | null;
  location: string | null;
  postalCode: string | null;
  country: string;
  currency: string;
  dispatchTimeMax: string | null;
  bestOffer: boolean;
  /** ShippingPackageDetails of the reference listing (weight replaced). */
  pkg: Record<string, unknown> | null;
  categoryId: string | null;
  conditionId: string | null;
};

export type PublishDraft = {
  draftId: string;
  title: string;
  description: string;
  condition: string;
  conditionNote: string | null;
  price: number;
  quantity: number;
  sku: string | null;
  categoryId: string;
  itemSpecifics: Record<string, string | string[]>;
  storeCategoryIds: string[];
  weightOz: number | null;
  pictureUrls: string[];
};

// ─── single trading cards ──────────────────────────────────────────────────
// eBay's card-single categories take only two conditions — Graded (2750) and
// Ungraded (4000) — each with required "condition descriptors" (who graded
// it and the grade, or the card's condition). Nifty can't send those, which
// is why single cards fail there with "Condition 3000 … not valid".

/** Sports singles, non-sport singles, CCG individual cards. */
export const CARD_SINGLE_CATEGORIES = ["261328", "183050", "183454"];

export function isCardSingle(categoryId: string | null | undefined): boolean {
  return CARD_SINGLE_CATEGORIES.includes(String(categoryId ?? ""));
}

export const UNGRADED = ["Near Mint or Better", "Excellent", "Very Good", "Poor"] as const;
export type UngradedCondition = (typeof UNGRADED)[number];

/** eBay's grading companies (descriptor 27501), by short name. */
export const GRADERS: Record<string, string> = {
  PSA: "275010",
  BCCG: "275011",
  BVG: "275012",
  BGS: "275013",
  CSG: "275014",
  CGC: "275015",
  SGC: "275016",
  KSA: "275017",
  GMA: "275018",
  HGA: "275019",
  ISA: "2750110",
  PCA: "2750111",
  GSG: "2750112",
  PGS: "2750113",
  MNT: "2750114",
  TAG: "2750115",
  Other: "2750123",
};

/** Grades (descriptor 27502). */
export const GRADES: Record<string, string> = {
  "10": "275020", "9.5": "275021", "9": "275022", "8.5": "275023", "8": "275024", "7.5": "275025", "7": "275026",
  "6.5": "275027", "6": "275028", "5.5": "275029", "5": "2750210", "4.5": "2750211", "4": "2750212", "3.5": "2750213",
  "3": "2750214", "2.5": "2750215", "2": "2750216", "1.5": "2750217", "1": "2750218", Authentic: "2750219",
};

export type CardCondition =
  | { graded: false; condition: UngradedCondition }
  | { graded: true; grader: string; grade: string; cert?: string | null };

export function cardConditionLabel(c: CardCondition): string {
  return c.graded ? `Graded: ${c.grader} ${c.grade}${c.cert ? ` (cert ${c.cert})` : ""}` : `Ungraded: ${c.condition}`;
}

/** Pure: a fair first guess from the draft. Graded when the note or the
 *  specifics name a grader and a grade ("PSA 9"); otherwise ungraded, from
 *  FIA's condition word and the condition note. Todd can change it. */
export function guessCardCondition(
  condition: string | null | undefined,
  note: string | null | undefined,
  specifics: Record<string, string | string[]> = {}
): CardCondition {
  const spec = (k: string) => {
    const v = specifics[k];
    return (Array.isArray(v) ? v[0] : v)?.toString().trim() ?? "";
  };
  const text = `${note ?? ""} ${spec("Professional Grader")} ${spec("Grade")}`;
  const graderRe = new RegExp(`\\b(${Object.keys(GRADERS).filter((g) => g !== "Other").join("|")})\\b[^0-9A-Za-z]{0,3}(10|[1-9](?:\\.5)?)\\b`);
  const m = graderRe.exec(text);
  if (m && !/\bungraded\b/i.test(note ?? "")) {
    const cert = /\bcert(?:ification)?\s*(?:#|no\.?|number)?\s*:?\s*([A-Za-z0-9-]{4,30})/i.exec(`${note ?? ""} ${spec("Certification Number")}`)?.[1] ?? null;
    return { graded: true, grader: m[1], grade: m[2], cert };
  }
  const said = spec("Card Condition").toLowerCase();
  const hit = UNGRADED.find((u) => said.startsWith(u.toLowerCase()));
  if (hit) return { graded: false, condition: hit };
  const c = (condition ?? "used").toLowerCase().trim();
  const n = (note ?? "").toLowerCase();
  if (c === "new" || c === "like new" || /\b(near mint|nm-mt|gem mint|mint)\b/.test(n)) return { graded: false, condition: "Near Mint or Better" };
  if (c === "pre-owned - fair" || c === "for parts or not working" || /\b(heavy|heavily|paper loss|torn|tear|water damage|pinhole|writing on)\b/.test(n))
    return { graded: false, condition: "Poor" };
  if (c === "pre-owned - good" || /\b(crease|creased|creases|stain|stains|rounded corners|moderate)\b/.test(n) || (/\bwear\b/.test(n) && !/\b(light|lightly|minor|slight|faint)(?:\W+\w+){0,3}?\W+wear\b/.test(n)))
    return { graded: false, condition: "Very Good" };
  return { graded: false, condition: "Excellent" };
}

/** Pure: a stored/sent value → a CardCondition, or null if it isn't one. */
export function cleanCardCondition(v: unknown): CardCondition | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (r.graded === true) {
    const grader = String(r.grader ?? "");
    const grade = String(r.grade ?? "");
    if (!GRADERS[grader] || !GRADES[grade]) return null;
    const cert = typeof r.cert === "string" && r.cert.trim() ? r.cert.trim().slice(0, 30) : null;
    return { graded: true, grader, grade, cert };
  }
  const condition = UNGRADED.find((u) => u === r.condition);
  return condition ? { graded: false, condition } : null;
}

/** Pure: eBay's ConditionID and ConditionDescriptors for a card single. CCG
 *  cards (183454) use the "played" wording for the ungraded values. */
export function cardConditionFields(c: CardCondition, categoryId: string): { conditionId: string; descriptors: Array<Record<string, string>> } {
  if (c.graded) {
    const d: Array<Record<string, string>> = [
      { Name: "27501", Value: GRADERS[c.grader] ?? GRADERS.Other },
      { Name: "27502", Value: GRADES[c.grade] ?? GRADES["9"] },
    ];
    if (c.cert) d.push({ Name: "27503", AdditionalInfo: c.cert.slice(0, 30) });
    return { conditionId: "2750", descriptors: d };
  }
  const ccg = categoryId === "183454";
  const value = ccg
    ? { "Near Mint or Better": "400010", Excellent: "400015", "Very Good": "400016", Poor: "400017" }[c.condition]
    : { "Near Mint or Better": "400010", Excellent: "400011", "Very Good": "400012", Poor: "400013" }[c.condition];
  return { conditionId: "4000", descriptors: [{ Name: "40001", Value: value }] };
}

/** Item specifics that clash with eBay's card condition fields. */
const CARD_CONDITION_SPECIFICS = new Set(["card condition", "graded", "professional grader", "grade", "certification number"]);

/** The Trading API <Item> for Verify/AddFixedPriceItem. */
export function buildItem(
  d: PublishDraft,
  ref: Reference,
  conditionId: string,
  descriptors?: Array<Record<string, string>> | null
): Record<string, unknown> {
  if (!d.title.trim()) throw new Error("The draft has no title");
  if (!(d.price > 0)) throw new Error("The draft has no price");
  if (!d.pictureUrls.length) throw new Error("The draft has no photos");
  if (!/^\d+$/.test(d.categoryId)) throw new Error("The draft has no eBay category");
  const item: Record<string, unknown> = {
    Title: d.title.slice(0, 80),
    Description: descriptionHtml(d.description),
    PrimaryCategory: { CategoryID: d.categoryId },
    StartPrice: { "@_currencyID": ref.currency, "#text": d.price.toFixed(2) },
    CategoryMappingAllowed: true,
    ConditionID: conditionId,
    ...(descriptors?.length ? { ConditionDescriptors: { ConditionDescriptor: descriptors } } : {}),
    Country: ref.country,
    Currency: ref.currency,
    ListingDuration: "GTC",
    ListingType: "FixedPriceItem",
    Quantity: Math.max(1, Math.floor(d.quantity || 1)),
    UUID: draftUuid(d.draftId),
    PictureDetails: { PictureURL: d.pictureUrls.slice(0, 24) },
  };
  if (d.conditionNote && conditionId !== "1000" && conditionId !== "2750") item.ConditionDescription = d.conditionNote.slice(0, 1000);
  if (d.sku) item.SKU = d.sku.slice(0, 50);
  if (ref.location) item.Location = ref.location;
  if (ref.postalCode) item.PostalCode = ref.postalCode;
  if (ref.dispatchTimeMax) item.DispatchTimeMax = ref.dispatchTimeMax;
  if (ref.bestOffer) item.BestOfferDetails = { BestOfferEnabled: true };
  const specifics = Object.entries(d.itemSpecifics)
    .filter(([name]) => !(descriptors?.length && CARD_CONDITION_SPECIFICS.has(name.toLowerCase().trim())))
    .map(([name, v]) => ({ name, values: (Array.isArray(v) ? v : [v]).map(String).filter(Boolean) }))
    .filter((s) => s.values.length);
  if (specifics.length) {
    item.ItemSpecifics = { NameValueList: specifics.map((s) => ({ Name: s.name, Value: s.values.length === 1 ? s.values[0] : s.values })) };
  }
  const store = d.storeCategoryIds.filter((x) => /^\d+$/.test(x));
  if (store.length) {
    item.Storefront = { StoreCategoryID: store[0], ...(store[1] ? { StoreCategory2ID: store[1] } : {}) };
  }
  const profiles: Record<string, unknown> = { SellerShippingProfile: { ShippingProfileID: ref.shippingProfileId } };
  if (ref.returnProfileId) profiles.SellerReturnProfile = { ReturnProfileID: ref.returnProfileId };
  if (ref.paymentProfileId) profiles.SellerPaymentProfile = { PaymentProfileID: ref.paymentProfileId };
  item.SellerProfiles = profiles;
  if (ref.pkg || d.weightOz) {
    const pkg: Record<string, unknown> = { ...(ref.pkg ?? {}) };
    if (d.weightOz && d.weightOz > 0) {
      const w = lbOz(d.weightOz);
      pkg.WeightMajor = { "@_unit": "lbs", "#text": String(w.major) };
      pkg.WeightMinor = { "@_unit": "oz", "#text": String(w.minor) };
    }
    item.ShippingPackageDetails = pkg;
  }
  return item;
}

export type EbayMessage = { severity: "Error" | "Warning"; code: string | null; message: string };

/** Errors/warnings from a Trading response's Errors node. */
export function ebayMessages(errors: unknown): EbayMessage[] {
  const arr = Array.isArray(errors) ? errors : errors ? [errors] : [];
  return arr.map((e: Record<string, unknown>) => ({
    severity: String(e.SeverityCode) === "Warning" ? ("Warning" as const) : ("Error" as const),
    code: e.ErrorCode != null ? String(e.ErrorCode) : null,
    message: String(e.LongMessage ?? e.ShortMessage ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
  }));
}

/** What eBay will actually charge, per fee line: the fee minus its
 *  PromotionalDiscount (a store's free monthly listings show up as an
 *  InsertionFee with an equal discount). Zero lines are left out. */
export function feeTotal(fees: unknown): { total: number; lines: Array<{ name: string; amount: number; listed?: number }> } {
  const list = ((fees as { Fee?: unknown })?.Fee ?? []) as unknown;
  const arr = Array.isArray(list) ? list : [list];
  const num = (v: unknown) => {
    const n = Number(typeof v === "object" && v ? (v as Record<string, unknown>)["#text"] : v);
    return Number.isFinite(n) ? n : 0;
  };
  const lines = arr
    .map((f: Record<string, unknown>) => {
      const listed = num(f?.Fee);
      const amount = Math.round(Math.max(0, listed - num(f?.PromotionalDiscount)) * 100) / 100;
      return { name: String(f?.Name ?? ""), amount, ...(amount !== listed ? { listed } : {}) };
    })
    .filter((l) => l.name && (l.amount > 0 || (l.listed ?? 0) > 0));
  return { total: Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100, lines };
}
