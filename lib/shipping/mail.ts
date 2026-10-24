// Mail facts for one listing (SHIP-2): how big the piece is, whether it
// fits an eBay Standard Envelope, and whether foundinalabama.com and
// theephemeralstate.com can mail it with stamps in a flat envelope instead
// of a parcel. Pure — tested in mail.test.mts; the refresh is mail-refresh.ts.
//
// Size comes from, in order:
//   measured  the FIA draft's measured size (facts.size_inches) or a size
//             item specific ("8 x 10 in")
//   title     a size in the title ("8x10 Photo", "5\" x 7\"")
//   format    a standard format the title or category names: postcard 6×4,
//             cabinet card 6½×4¼, CDV 4¼×2½, trading card 3½×2½
// No size → no stamped mail and no Standard Envelope switch (FIA won't guess).
//
// USPS / eBay limits (looked up Oct 24, 2026):
//   eBay Standard Envelope: envelope ≤ 6⅛ × 11½ in, ≤ ¼ in thick, ≤ 3 oz,
//     ≤ $20; ≤ 3 postcards, ≤ 24 raw cards, no graded cards.
//   USPS First-Class large envelope (flat): ≤ 12 × 15 in, ≤ ¾ in thick,
//     ≤ 13 oz, flexible and uniformly thick — rigid or lumpy pieces pay
//     parcel prices. A thin chipboard stiffener that still bends is fine.
// The item has to fit INSIDE the envelope, so the limits below leave a
// margin. Framed, boxed, bound, metal, glass and other rigid pieces never
// qualify.

/** eBay only allows Standard Envelope up to this item price; stamped mail on
 *  the sites uses the same cap (Todd, Oct 24: "Flat paper, $20 or less"). */
export const MAIL_MAX_PRICE = 20;

/** Largest item (long × short, inches) that goes in a Standard Envelope. */
export const SE_ITEM_MAX = { long: 11.25, short: 6 };
/** Largest item that goes in a 12 × 15 flat with a stiffener. */
export const FLAT_ITEM_MAX = { long: 14, short: 11 };
/** Most pieces in one stamped flat (thickness ≤ ¾ in, weight ≤ 13 oz). */
export const FLAT_MAX_PIECES = 10;

export type SizeSource = "measured" | "title" | "format";
export type MailSize = { long: number; short: number; source: SizeSource };

/** "8.6x2.4in", "8 x 10 in", "5\" x 7\"" → [long, short]. */
export function parseSize(s: string | null | undefined): [number, number] | null {
  const m = String(s ?? "").match(/(\d{1,2}(?:\.\d+)?)\s*(?:"|''|in\b|inch(?:es)?)?\s*[x×]\s*(\d{1,2}(?:\.\d+)?)/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!(a > 0 && b > 0)) return null;
  return [Math.max(a, b), Math.min(a, b)];
}

const CARD_CATEGORIES = new Set(["261328", "183050", "183454"]);

const FORMATS: Array<{ re: RegExp; size: [number, number] }> = [
  { re: /\bcabinet\s+cards?\b/i, size: [6.5, 4.25] },
  { re: /\b(cdv|cdvs|carte[s]? de visite)\b/i, size: [4.25, 2.5] },
  { re: /\b(rppc|real photo post\s?cards?|post\s?cards?|postcards?)\b/i, size: [6, 4] },
  { re: /\btrading cards?\b|\b(baseball|football|basketball|hockey|rookie|sports?) cards?\b/i, size: [3.5, 2.5] },
];

/** Rigid, bulky or bound — never in an envelope. */
const NOT_FLAT_RE =
  /\b(framed|frame|album|albums|scrapbook|binder|booklet|book|books|folder|portfolio|tin\b|tins\b|metal|glass|tintype|ambrotype|daguerreotype|wood|wooden|plaque|sign|slab|graded|psa\s*\d|bgs\s*\d|sgc\s*\d|cgc\s*\d|mounted on board|canvas|poster tube|rolled|button|pinback|pin)\b/i;

/** "Lot of 12", "3 Vintage Snapshot Photos" → 12 / 3; 1 when none. */
export function pieceCount(title: string): number {
  const t = String(title ?? "");
  const lot = /\blot\s+(?:of\s+)?(\d{1,4})\b/i.exec(t) ?? /\b(\d{1,4})\s*(?:pc|pcs|piece)?\s*(?:card\s+)?lot\b/i.exec(t);
  if (lot) return Number(lot[1]);
  const n = /(?:^|\s)(\d{1,3})\s+(?:[A-Za-z][A-Za-z'&-]*\s+|\d{2,4}s\s+|\d{4}\s+){0,4}(?:photos?|photographs?|snapshots?|post\s?cards?|postcards?|cards?|pieces?|pcs|prints?|tickets?|stamps?|labels?)\b/i.exec(t);
  return n ? Math.max(1, Number(n[1])) : 1;
}

const PAPER_KINDS = new Set(["ephemera", "photograph", "document", "map", "greeting_card", "trading_card", "postcard"]);
const PAPER_CATEGORY_RE =
  /photograph|postcard|ephemera|greeting card|trading card|sheet music|\bpaper\b|trade card|cabinet card|scripophily|paper money|stamps|ccg individual|advertising.*\b(ads|other collectible ads)\b/i;
const NOT_PAPER_CATEGORY_RE = /\bbooks?\b|magazine|album|frame|sign|tins?\b|bottle|figurine|pinback|button/i;

export type MailInput = {
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  price: number | null;
  /** FIA draft identification kind, when FIA wrote the listing. */
  kind?: string | null;
  /** FIA draft's measured size ("8.6x5.4in") or a size item specific. */
  measured?: string | null;
};

export type MailFacts = {
  size: MailSize | null;
  /** Fits an eBay Standard Envelope (size, piece count, not rigid). Null = size unknown. */
  seFit: boolean | null;
  /** Mail it with stamps in a flat on FIA/TES. */
  stampOk: boolean;
  pieces: number;
  reason: string;
};

/** Pure: the mail facts for one listing. */
export function mailFacts(i: MailInput): MailFacts {
  const title = String(i.title ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
  const cat = (i.categoryName ?? "").replace(/&amp;/g, "&");
  const pieces = pieceCount(title);

  let size: MailSize | null = null;
  const m = parseSize(i.measured);
  if (m) size = { long: m[0], short: m[1], source: "measured" };
  if (!size) {
    const t = parseSize(title.replace(/\b(19|20)\d{2}\s*[x×]/g, " "));
    if (t && t[0] <= 40) size = { long: t[0], short: t[1], source: "title" };
  }
  if (!size && i.categoryId && CARD_CATEGORIES.has(i.categoryId)) size = { long: 3.5, short: 2.5, source: "format" };
  if (!size) {
    const f = FORMATS.find((x) => x.re.test(title) || x.re.test(cat));
    if (f) size = { long: f.size[0], short: f.size[1], source: "format" };
  }

  if (NOT_FLAT_RE.test(title)) {
    return { size, seFit: size ? false : null, stampOk: false, pieces, reason: "rigid, bound or graded — not an envelope piece" };
  }

  const kind = (i.kind ?? "").toLowerCase();
  const paper = PAPER_KINDS.has(kind) || (PAPER_CATEGORY_RE.test(cat) && !NOT_PAPER_CATEGORY_RE.test(cat));
  const isPostcard = /postcard/i.test(cat) || /\b(rppc|post\s?cards?|postcards?)\b/i.test(title);
  const isCard = (i.categoryId != null && CARD_CATEGORIES.has(i.categoryId)) || /trading card/i.test(cat);
  const sePieceLimit = isCard ? 24 : isPostcard ? 3 : 5;

  const seFit = size ? size.long <= SE_ITEM_MAX.long && size.short <= SE_ITEM_MAX.short && pieces <= sePieceLimit : null;

  let stampOk = false;
  let reason: string;
  if (!paper) reason = "not flat paper";
  else if (i.price == null || i.price > MAIL_MAX_PRICE) reason = `over $${MAIL_MAX_PRICE}`;
  else if (!size) reason = "size unknown";
  else if (size.long > FLAT_ITEM_MAX.long || size.short > FLAT_ITEM_MAX.short) reason = `${size.long}×${size.short} in is too big for a 12×15 flat`;
  else if (pieces > FLAT_MAX_PIECES) reason = `${pieces} pieces is too thick for one flat`;
  else {
    stampOk = true;
    reason = `flat paper ${size.long}×${size.short} in (${size.source})`;
  }
  return { size, seFit, stampOk, pieces, reason };
}

export function sizeText(s: MailSize | null): string | null {
  return s ? `${s.long}x${s.short}` : null;
}
