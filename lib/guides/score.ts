// Expert Guide linker — the scoring half (pure, no database).
//
// Given the guide library's manifest rows and one item (title, eBay site
// category, store shelf, and the guide its listing was written with, if any),
// pick the guide that covers the item. Whole-word keyword matches only: the
// writer's router uses substring matches ("ring" inside "spring"), which is
// fine for choosing context but too loose for filing sales under a guide.

export type LinkGuide = {
  id: string;
  family: string;
  parent: string | null;
  stage: string;
  priority: number;
  keywords: string[];
  ebayCategoryIds?: string[];
  storeCategories?: string[];
};

export type LinkItem = {
  title: string;
  siteCategoryId?: string | null;
  storeCategory?: string | null;
  /** Guides the item's listing draft was written with (FIA writer or Claude). */
  draftGuideIds?: string[] | null;
};

export type LinkResult = {
  guideId: string | null;
  score: number;
  /** Best guide from a different branch of the library, when one scored. */
  altGuideId: string | null;
  altScore: number;
  confident: boolean;
};

type Compiled = {
  g: LinkGuide;
  root: string;
  words: Array<{ re: RegExp; weight: number }>;
  cats: Set<string>;
  shelves: Set<string>;
};

export type Linker = { score: (item: LinkItem) => LinkResult; guideIds: Set<string> };

const WEIGHT_PHRASE = 3; // "sewing pattern", "real photo postcard"
const WEIGHT_WORD = 1; // "postcard", "rppc"
const WORD_CAP = 3; // single words together never count for more than one phrase
const WEIGHT_CATEGORY = 3; // the manifest names this eBay category (only counts with a word or shelf match)
const WEIGHT_SHELF = 4; // the manifest names this store shelf (shelves are picked per item)
const WEIGHT_DRAFT = 4; // the listing was written with this guide
const CONFIDENT_AT = 3;

// A guide family only applies to items of its format: a postcard guide needs a
// postcard, a photo guide needs a photograph (and a postcard is not one).
const POSTCARD = /post ?cards?|rppc/;
const FAMILY_GATE: Record<string, (title: string) => boolean> = {
  Postcards: (t) => POSTCARD.test(t) || /qsl/.test(t),
  Photographs: (t) =>
    !POSTCARD.test(t) &&
    /photo|snapshot|cabinet card|\bcdv\b|carte de visite|tintype|daguerreotype|ambrotype|stereoview|\bslides?\b|negative|\balbum/.test(t),
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#39;|[’‘]/g, "'")
    .replace(/&quot;|[“”]/g, '"');

function keywordRe(raw: string): { re: RegExp; weight: number } | null {
  const k = norm(String(raw ?? "")).trim();
  if (k.length < 3) return null;
  const parts = k.split(/\s+/);
  const esc = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]+");
  // Allow a plain plural on the last word ("matchbook" finds "matchbooks").
  const plural = /[a-z]$/.test(k) && !/s$/.test(k) ? "(?:s|es)?" : "";
  return {
    re: new RegExp(`(?<![a-z0-9])${esc}${plural}(?![a-z0-9])`),
    weight: parts.length > 1 ? WEIGHT_PHRASE : WEIGHT_WORD,
  };
}

/** Item-type guides only: buy-side, sorting playbooks and decoders don't own items. */
export function linkable(g: LinkGuide): boolean {
  return g.stage === "list" && g.family !== "Cross-cutting";
}

export function buildLinker(guides: LinkGuide[]): Linker {
  const pool = guides.filter(linkable);
  const byId = new Map(pool.map((g) => [g.id, g]));
  const rootOf = (g: LinkGuide): string => {
    let cur = g;
    for (let i = 0; i < 6 && cur.parent && byId.has(cur.parent); i++) cur = byId.get(cur.parent)!;
    return cur.id;
  };
  const compiled: Compiled[] = pool.map((g) => ({
    g,
    root: rootOf(g),
    words: g.keywords.map(keywordRe).filter((x): x is { re: RegExp; weight: number } => !!x),
    cats: new Set((g.ebayCategoryIds ?? []).map(String)),
    shelves: new Set((g.storeCategories ?? []).map((s) => norm(s).trim())),
  }));

  function score(item: LinkItem): LinkResult {
    const title = norm(item.title ?? "");
    const cat = item.siteCategoryId ? String(item.siteCategoryId) : "";
    const shelf = item.storeCategory ? norm(item.storeCategory).trim() : "";
    const drafted = new Set(item.draftGuideIds ?? []);
    const scored: Array<{ c: Compiled; s: number; text: number; fromDraft: boolean }> = [];
    for (const c of compiled) {
      const fromDraft = drafted.has(c.g.id);
      const gate = FAMILY_GATE[c.g.family];
      if (gate && !fromDraft && !gate(title)) continue;
      let phrases = 0;
      let words = 0;
      for (const w of c.words) {
        if (!w.re.test(title)) continue;
        if (w.weight === WEIGHT_PHRASE) phrases += WEIGHT_PHRASE;
        else words += WEIGHT_WORD;
      }
      const text = phrases + Math.min(words, WORD_CAP);
      let s = text;
      const onShelf = !!shelf && c.shelves.has(shelf);
      if (onShelf) s += WEIGHT_SHELF;
      if (cat && c.cats.has(cat) && (text > 0 || onShelf)) s += WEIGHT_CATEGORY;
      if (fromDraft) s += WEIGHT_DRAFT;
      if (s > 0) scored.push({ c, s, text, fromDraft });
    }
    if (!scored.length) return { guideId: null, score: 0, altGuideId: null, altScore: 0, confident: false };
    // Highest score; on a tie the more specific guide (a child), then the one
    // with more of its own words in the title, then manifest priority.
    scored.sort(
      (a, b) =>
        b.s - a.s ||
        Number(!!b.c.g.parent) - Number(!!a.c.g.parent) ||
        b.text - a.text ||
        a.c.g.priority - b.c.g.priority ||
        a.c.g.id.localeCompare(b.c.g.id)
    );
    let best = scored[0];
    // The parent guide carries a family's common words ("postcard") and is what
    // the writer always loads, so it tends to outscore its children. When one
    // of its children has a word of its own in the title, the child is the
    // more specific home for the item.
    const kid = scored.find((x) => x.c.g.parent === best.c.g.id && x.text > 0);
    if (kid) best = { ...kid, s: Math.max(kid.s, best.s), fromDraft: kid.fromDraft || best.fromDraft };
    const rival = scored.find((x) => x.c.root !== best.c.root) ?? null;
    // A shelf on its own is a hint, not proof ("Advertising Ephemera" holds far
    // more than blotters): a confident link needs the title or the draft to agree.
    const backed = best.text > 0 || best.fromDraft;
    const confident = backed && best.s >= CONFIDENT_AT && (!rival || rival.s * 2 <= best.s);
    return {
      guideId: best.c.g.id,
      score: best.s,
      altGuideId: rival ? rival.c.g.id : null,
      altScore: rival ? rival.s : 0,
      confident,
    };
  }

  return { score, guideIds: new Set(pool.map((g) => g.id)) };
}
