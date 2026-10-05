// Phase HIP-3 — which TES items go to HipPostcard, and under which Hip
// category. Pure (no DB, no network) so it is unit-testable and shared by
// the publisher and the readiness page.
//
// Todd's decisions (2026-10-05):
//   • Pool = the TES selection (theephemeralstate.com), in stock.
//   • Excluded from Hip: books (all kinds), whole magazines, sports and
//     game cards, comics, pinbacks, signs & plaques.
//   • Everything else maps to the closest Hip Postcard / Ephemera category.
//     Anything the rules don't recognise is held for review, never guessed.
//
// Category IDs verified against
// https://www.hippostcard.com/api-field-values/?filter=categories on
// 2026-10-05. 0 and 2056 are Hip's documented "magic" postcard categories
// (Hip files the card by location / topic itself).
//
// HipPostcard has no confirmed category for loose photographs in the
// verified list, so they default to Ephemera › Other / Unsorted. Set
// HIP_CATEGORY_PHOTOGRAPHS to a better leaf ID if Hip support names one.

import { decodeEntities } from "../ebay/entities";

export type HipPlan =
  | { action: "list"; categoryId: number; categoryName: string; rule: string }
  | { action: "exclude"; reason: string }
  | { action: "review"; reason: string };

export const HIP_CATEGORIES = {
  postcardLocation: [0, "Postcards · automatic location"],
  postcardTopic: [2056, "Postcards · automatic topic"],
  advertising: [36423, "Ephemera · Advertising"],
  announcements: [36424, "Ephemera · Announcements"],
  blotters: [36426, "Ephemera · Blotters"],
  bookmarks: [36427, "Ephemera · Bookmarks"],
  bookplates: [36428, "Ephemera · Bookplates"],
  calendars: [36429, "Ephemera · Calendars"],
  checks: [36430, "Ephemera · Checks"],
  devotion: [36481, "Ephemera · Chromo › Devotion Images"],
  printedImages: [36482, "Ephemera · Chromo › Printed Images"],
  dieCuts: [36484, "Ephemera · Chromo › Victorian Die-Cuts"],
  tradeCardsCigarette: [36488, "Ephemera · Trade Cards › Cigarette Cards"],
  tradeCardsStores: [36490, "Ephemera · Trade Cards › Stores & Businesses"],
  coupons: [36445, "Ephemera · Coupons"],
  school: [36432, "Ephemera · Diplomas & School Related"],
  historical: [36433, "Ephemera · Historical Documents"],
  invoices: [36434, "Ephemera · Invoices & Commercial Agreements"],
  legal: [36435, "Ephemera · Legal Documents"],
  manuscripts: [36437, "Ephemera · Manuscripts"],
  maps: [36438, "Ephemera · Maps"],
  lots: [36451, "Ephemera · Collections & Lots"],
  menus: [36439, "Ephemera · Menus"],
  other: [36453, "Ephemera · Other / Unsorted"],
  programs: [36440, "Ephemera · Programs"],
  scores: [36441, "Ephemera · Scores"],
  stock: [36443, "Ephemera · Stock Certificates"],
  timetables: [36446, "Ephemera · Timetables & Schedules"],
  brochures: [36447, "Ephemera · Tourism Brochures"],
  posters: [36449, "Ephemera · Vintage Posters"],
  visitingCards: [36450, "Ephemera · Visiting Cards"],
  greetingCards: [36513, "Ephemera · Vintage Greeting Cards"],
  transBoats: [36456, "Ephemera · Transportation › Boats"],
  transCars: [36458, "Ephemera · Transportation › Cars"],
  transTrains: [36462, "Ephemera · Transportation › Trains"],
  transOther: [36465, "Ephemera · Transportation › Other / Unsorted"],
  transAir: [36512, "Ephemera · Transportation › Airlines & Airplanes"],
} as const satisfies Record<string, readonly [number, string]>;

type Key = keyof typeof HIP_CATEGORIES;

function list(key: Key, rule: string): HipPlan {
  const [categoryId, categoryName] = HIP_CATEGORIES[key];
  return { action: "list", categoryId, categoryName, rule };
}

function photoCategory(env: Record<string, string | undefined>): HipPlan {
  const override = Number(env.HIP_CATEGORY_PHOTOGRAPHS);
  if (Number.isInteger(override) && override > 0) {
    return { action: "list", categoryId: override, categoryName: "Photographs (configured)", rule: "eBay photograph category" };
  }
  return list("other", "eBay photograph category (no confirmed Hip photo category)");
}

// Title keywords → a more specific Ephemera leaf. Order matters: the first
// hit wins, so narrower phrases sit above broader ones.
const KEYWORD_RULES: Array<[RegExp, Key]> = [
  [/\b(rppc|real photo post ?card|post ?cards?)\b/i, "postcardTopic"],
  [/\bsheet music\b|\bsong ?book\b/i, "scores"],
  [/\bmenus?\b/i, "menus"],
  [/\b(programs?|programme|playbill|souvenir book)\b/i, "programs"],
  [/\bcalendars?\b/i, "calendars"],
  [/\bblotters?\b/i, "blotters"],
  [/\bbookplates?\b|\bex libris\b/i, "bookplates"],
  [/\bbookmarks?\b/i, "bookmarks"],
  [/\b(cigarette|tobacco) cards?\b/i, "tradeCardsCigarette"],
  [/\btrade ?cards?\b/i, "tradeCardsStores"],
  [/\bdie[- ]?cuts?\b|\bscrap ?(relief|book)? ?die\b/i, "dieCuts"],
  [/\b(holy|prayer|devotional) cards?\b/i, "devotion"],
  [/\btime ?tables?\b|\bschedules?\b/i, "timetables"],
  [/\bstock certificates?\b|\bbond certificates?\b/i, "stock"],
  [/\b(cancell?ed|bank) checks?\b|\bcheck(s)? (drawn|written)\b/i, "checks"],
  [/\bdiplomas?\b|\breport cards?\b|\byearbooks?\b/i, "school"],
  [/\b(invoices?|bill ?heads?|letterheads?|receipts?)\b/i, "invoices"],
  [/\b(deeds?|indentures?|land grants?|court documents?)\b/i, "legal"],
  [/\b(letters?|correspondence|manuscripts?|handwritten)\b/i, "manuscripts"],
  [/\b(announcements?|invitations?)\b/i, "announcements"],
  [/\bcoupons?\b/i, "coupons"],
  [/\b(calling|visiting) cards?\b/i, "visitingCards"],
  [/\bposters?\b/i, "posters"],
  [/\b(road )?maps?\b|\batlas\b/i, "maps"],
  [/\b(brochures?|travel folders?|souvenir folders?|guide ?books?|pamphlets?)\b/i, "brochures"],
  [/\b(greeting cards?|valentines?|christmas cards?|birthday cards?|easter cards?)\b/i, "greetingCards"],
  [/\b(ads?|advertisements?|advertising)\b/i, "advertising"],
];

function byKeyword(title: string): Key | null {
  for (const [re, key] of KEYWORD_RULES) if (re.test(title)) return key;
  return null;
}

export type HipPlanInput = {
  siteCategoryId: string | null;
  siteCategoryName: string | null;
  title: string;
};

export function planHipListing(item: HipPlanInput, env: Record<string, string | undefined> = process.env): HipPlan {
  const path = decodeEntities(item.siteCategoryName).toLowerCase();
  const title = decodeEntities(item.title);

  // ── Exclusions (Todd, 2026-10-05) ──────────────────────────────────────
  if (/^books & magazines:magazines/.test(path)) return { action: "exclude", reason: "Whole magazines stay off Hip" };
  if (/^books & magazines/.test(path)) return { action: "exclude", reason: "Books stay off Hip" };
  if (/sports trading cards|collectible card games|sports mem.*:trading cards/.test(path)) return { action: "exclude", reason: "Sports & game cards stay off Hip" };
  if (/comic books|:comics(:|$)/.test(path)) return { action: "exclude", reason: "Comics stay off Hip" };
  if (/pinbacks/.test(path)) return { action: "exclude", reason: "Pinbacks stay off Hip" };
  if (/plaques & signs|:signs(:|$)/.test(path)) return { action: "exclude", reason: "Signs & plaques stay off Hip" };

  // ── Postcards ──────────────────────────────────────────────────────────
  if (item.siteCategoryId === "262042") return list("postcardLocation", "eBay topographical postcard");
  if (item.siteCategoryId === "262043") return list("postcardTopic", "eBay non-topographical postcard");
  if (/postcards & supplies:postcards/.test(path)) return list("postcardTopic", "eBay postcard category");
  if (/holiday & seasonal:cards & postcards/.test(path)) {
    return /\bpost ?cards?\b|\brppc\b/i.test(title)
      ? list("postcardTopic", "eBay holiday card category, titled as a postcard")
      : list("greetingCards", "eBay holiday card category");
  }

  // ── Fixed category families ────────────────────────────────────────────
  if (/vintage greeting cards/.test(path)) return list("greetingCards", "eBay vintage greeting card category");
  if (/photographic images/.test(path)) return photoCategory(env);
  if (/maps & atlases|maps, atlases & globes/.test(path)) return list("maps", "eBay map category");
  if (/wholesale lots:postcards & paper/.test(path)) return list("lots", "eBay postcard & paper lot");
  if (/greeting cards & invitations/.test(path)) return list("greetingCards", "eBay greeting card category");
  if (/breweriana.*:(advertising-print|labels|posters, prints)/.test(path)) return list("advertising", "eBay breweriana paper category");
  if (/sheet music & song books/.test(path)) return list("scores", "eBay sheet music category");
  if (/genealogy/.test(path)) return list("historical", "eBay genealogy category");
  if (/railroadiana/.test(path)) {
    const k = byKeyword(title);
    return k === "timetables" || k === "postcardTopic" ? list(k, `Railroadiana, title keyword`) : list("transTrains", "eBay railroadiana category");
  }
  if (/^collectibles:transportation:automobilia/.test(path)) return list("transCars", "eBay automobilia category");
  if (/^collectibles:transportation:boats & ships/.test(path)) return list("transBoats", "eBay boats & ships category");
  if (/^collectibles:transportation:aviation/.test(path)) return list("transAir", "eBay aviation category");
  if (/^collectibles:transportation/.test(path)) return list("transOther", "eBay transportation category");
  if (/^art:|posters & prints/.test(path)) {
    return /\bposters?\b/i.test(title) ? list("posters", "Art/poster category, titled as a poster") : list("printedImages", "eBay art print category");
  }

  // ── Paper-ish families: refine by title, else a sensible default ───────
  const paperish =
    /^collectibles:paper|souvenirs & travel|^collectibles:advertising|militaria|historical memorabilia|religion & spirituality|cultures & ethnicities|tobacciana|animals|radio, phonograph|entertainment memorabilia|vintage sports memorabilia:publications/.test(path);
  if (paperish) {
    const k = byKeyword(title);
    if (k === "postcardTopic" && /souvenirs & travel/.test(path)) return list("postcardLocation", "Travel souvenir titled as a postcard");
    if (k) return list(k, "Title keyword within a paper/ephemera category");
    if (/^collectibles:advertising/.test(path)) return list("advertising", "eBay advertising category");
    if (/paper:brochures/.test(path)) return list("brochures", "eBay brochure category");
    if (/paper:correspondence/.test(path)) return list("manuscripts", "eBay correspondence category");
    return list("other", "Paper/ephemera category without a closer Hip match");
  }

  return { action: "review", reason: `No Hip category rule for “${decodeEntities(item.siteCategoryName) || "unknown category"}”` };
}
