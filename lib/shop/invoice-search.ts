// Invoice custom searches (COUPON-2c): instead of a shelf, the stock line
// can count a site search ("theephemeralstate.com has 37 items matching
// “Anniston” in stock today") and the QR code opens that search with the
// coupon code attached. Todd types words or pastes a search link on the
// Ship page, picks a recent one, or takes a suggested place search built
// from the sold item's title. Pure helpers here; counting is
// lib/search/search.ts countSearch().

import { stockNumber, SITE_DOMAIN, type Site } from "./invoice-pitch";

export type PitchSearch = {
  site: Site;
  q: string;
  category?: string | null;
  min?: number | null;
  max?: number | null;
  /** Wording after the count, e.g. "Anniston, Alabama pieces". */
  label?: string | null;
};

const num = (v: string | null): number | null => {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Pure: what Todd typed or pasted → a search (null if it isn't one). A
 *  link's domain decides the site; plain words use `defaultSite`. */
export function parseSearchInput(input: string, defaultSite: Site): PitchSearch | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (/^(https?:\/\/|www\.|foundinalabama\.com|theephemeralstate\.com)/i.test(raw)) {
    let u: URL;
    try {
      u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const site: Site | null = host === "theephemeralstate.com" ? "tes" : host === "foundinalabama.com" ? "fia" : null;
    if (!site || !/^\/(tes\/)?search\/?$/.test(u.pathname)) return null;
    const q = (u.searchParams.get("q") ?? "").trim().slice(0, 120);
    const category = (u.searchParams.get("category") ?? "").replace(/[^0-9]/g, "") || null;
    const out: PitchSearch = { site, q, category, min: num(u.searchParams.get("min")), max: num(u.searchParams.get("max")) };
    return out.q || out.category ? out : null;
  }
  return { site: defaultSite, q: raw.slice(0, 120) };
}

/** Pure: the search's page, with the coupon code. */
export function searchPitchUrl(ps: PitchSearch, code?: string | null): string {
  const u = new URLSearchParams();
  if (ps.q) u.set("q", ps.q);
  if (ps.category) u.set("category", ps.category);
  if (ps.min != null) u.set("min", String(ps.min));
  if (ps.max != null) u.set("max", String(ps.max));
  if (code) u.set("code", code);
  return `https://${SITE_DOMAIN[ps.site]}/search?${u.toString()}`;
}

/** Pure: the invoice line. */
export function searchPitchText(ps: PitchSearch, count: number): string {
  const domain = SITE_DOMAIN[ps.site];
  const label = ps.label?.trim();
  return label
    ? `${domain} has ${stockNumber(count)} ${label} in stock today`
    : `${domain} has ${stockNumber(count)} items matching “${ps.q.replace(/"/g, "")}” in stock today`;
}

/** Pure: short name for menus ("Anniston" on TES). */
export function searchName(ps: PitchSearch): string {
  return `${ps.q || "(filters)"}${ps.category ? " · one shelf" : ""}${ps.min != null || ps.max != null ? " · price range" : ""}`;
}

/** Pure: same search? (for recent-search lists) */
export function searchKey(ps: PitchSearch): string {
  return [ps.site, ps.q.trim().toLowerCase(), ps.category ?? "", ps.min ?? "", ps.max ?? "", (ps.label ?? "").trim()].join("|");
}

export function cleanPitchSearch(v: unknown): PitchSearch | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const site: Site = r.site === "tes" ? "tes" : "fia";
  const q = typeof r.q === "string" ? r.q.trim().slice(0, 120) : "";
  const category = typeof r.category === "string" && /^\d{1,20}$/.test(r.category) ? r.category : null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
  const label = typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 60) : null;
  if (!q && !category) return null;
  return { site, q, category, min: n(r.min), max: n(r.max), label };
}

// ─── suggested place searches ───────────────────────────────────────────────

const STATES =
  "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming";
const ABBR =
  "AL|AK|AZ|AR|CA|CO|CT|FL|GA|ID|IL|IA|KS|KY|LA|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|Ala|Ga|Tenn|Miss|Fla|Penn|Penna|Calif|Mich|Ill|Ind|Wis|Minn|Mass|Conn|Ky|Va|Ark|Tex|Okla|Colo|Kans";
// Alabama places that often appear without the state name.
const ALABAMA_PLACES = [
  "Anniston", "Birmingham", "Montgomery", "Mobile", "Huntsville", "Tuscaloosa", "Gadsden", "Dothan", "Auburn", "Opelika",
  "Decatur", "Sheffield", "Tuscumbia", "Muscle Shoals", "Selma", "Talladega", "Sylacauga", "Alexander City",
  "Lineville", "Ashland", "Wedowee", "Roanoke", "Heflin", "Piedmont", "Fort Payne", "Scottsboro",
  "Guntersville", "Albertville", "Boaz", "Cullman", "Jasper", "Bessemer", "Fairfield", "Hueytown", "Homewood", "Mountain Brook",
  "Vestavia", "Hoover", "Pell City", "Leeds", "Childersburg", "Clanton", "Prattville", "Wetumpka", "Tuskegee", "Union Springs",
  "Eufaula", "Andalusia", "Brewton", "Atmore", "Bay Minette", "Fairhope",
  "Daphne", "Gulf Shores", "Orange Beach", "Dauphin Island", "Point Clear", "Foley", "Demopolis", "Eutaw",
  "Thomasville", "Monroeville", "Evergreen", "Luverne", "Hartselle", "Moulton",
  "Russellville", "Haleyville", "Winfield", "Centreville", "Columbiana", "Montevallo",
  "Calera", "Phenix City", "Lanett", "LaFayette", "Dadeville", "Goodwater", "Cheaha", "Mentone",
  "Tallassee", "Notasulga", "Abbeville", "Headland", "Florala", "Opp", ];
const PLACE_PREFIX = new Set("fort saint st. st mount mt. mt port new north south east west lake glen palm gulf bay grand cedar atlantic pine rock spring green las los san santa el la des de pell union phenix muscle orange dauphin point alexander bay".split(" "));
const PLACE_SUFFIX = new Set("city springs beach falls park heights hills island shores harbor village junction creek valley ridge bluff".split(" "));
const NOT_PLACES = new Set(
  "vintage antique old early rare lot set greetings greeting souvenir postcard postcards linen chrome photo real rppc map maps the a of and in at on for from with view views scene scenes street avenue ave main downtown hotel motel court courts church school college university high county state park lake river bridge depot station building bank store new north south east west lower upper little big great beautiful scenic aerial bird's birds eye night sons son co inc company studio studios bros brothers photo photos card cards letterhead stationery envelope cover newspaper program map highway souvenir folder chart umbrella".split(" ")
);

/** Pure: place names in the sold items' titles, most specific first:
 *  "<Town>, <State>" / "<Town> AL" patterns, "<Name> County", and known
 *  Alabama towns. At most `max`. */
export function placeCandidates(titles: string[], max = 4): string[] {
  const out: string[] = [];
  const add = (p: string) => {
    const t = p.replace(/\s+/g, " ").trim();
    if (!t || out.some((o) => o.toLowerCase() === t.toLowerCase())) return;
    out.push(t);
  };
  const cap = "[A-Z][a-zA-Z'.]+";
  const townState = new RegExp(`\\b((?:${cap}\\s){0,2}${cap}),?\\s+(?:${STATES}|(?:${ABBR})\\.?)(?=\\b|\\s|$)`, "g");
  const county = new RegExp(`\\b((?:${cap}\\s)?${cap})\\s+County\\b`, "g");
  const ok = (w: string) => !NOT_PLACES.has(w.toLowerCase()) && !/^[A-Z]{2,4}$/.test(w);
  for (const title of titles) {
    const t = String(title ?? "").replace(/&amp;/g, "&");
    for (const m of t.matchAll(townState)) {
      // The town is the word right before the state ("Letterhead Macon GA" →
      // "Macon"), plus a word before it when that's part of a place name
      // ("Atlantic City", "Fort Payne", "Gulf Shores").
      const words = m[1].split(/\s+/);
      const last = words[words.length - 1];
      if (!ok(last) || new RegExp(`^(?:${STATES})$`).test(last)) continue;
      const prev = words[words.length - 2];
      const two = prev && (PLACE_PREFIX.has(prev.toLowerCase()) || PLACE_SUFFIX.has(last.toLowerCase())) && !NOT_PLACES.has(prev.toLowerCase());
      add(two ? `${prev} ${last}` : last);
    }
    for (const m of t.matchAll(county)) {
      const words = m[1].split(/\s+/);
      while (words.length && NOT_PLACES.has(words[0].toLowerCase())) words.shift();
      if (words.length && !/^[A-Z]{2,4}$/.test(words[0])) add(`${words.join(" ")} County`);
    }
    for (const p of ALABAMA_PLACES) if (new RegExp(`\\b${p.replace(/ /g, "\\s+")}\\b`).test(t)) add(p);
  }
  return out.slice(0, max);
}

/** Pure: the search for a suggested place (quoted when it's several words). */
export function placeQuery(place: string): string {
  return place.includes(" ") ? `"${place}"` : place;
}
