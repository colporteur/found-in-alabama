// Site search (SEARCH-1) — pure query handling: what the shopper typed →
// groups of alternatives to match, with Todd's synonyms folded in.
//
//   bham postcards        → [bham | birmingham] AND [postcards]
//   "crimson tide" mug    → ["crimson tide" | bama | university of alabama …] AND [mug]
//   -reproduction         → excluded word
//
// Stemming (postcards ↔ postcard), accents and typos are handled in SQL;
// this only decides WHAT to look for.

export type QueryTerm = { text: string; phrase: boolean };
export type ParsedQuery = {
  /** Each group must match (AND); any alternative within a group may (OR). */
  groups: string[][];
  /** Words the shopper excluded with a leading minus. */
  exclude: string[];
  /** The plain words typed (for typo suggestions), lowercased. */
  words: string[];
  /** Cleaned query text (for logging, fuzzy matching and embeddings). */
  text: string;
};

/** Default synonym groups — Todd edits these on /admin/search. Every term in
 *  a group finds the others. */
export const DEFAULT_SYNONYMS = `bham, birmingham
bama, university of alabama, crimson tide, roll tide
war eagle, auburn university
jsu, jacksonville state
hsv, huntsville
t town, tuscaloosa
rppc, real photo postcard
photo, photograph, snapshot
postcard, post card
ad, advertisement, advertising
xmas, christmas
railroad, railway, railroadiana
lp, vinyl record
brochure, pamphlet
nasa, space program
civil rights, civil rights movement
mardi gras, carnival`;

const MAX_GROUPS = 8;

/** Pure: synonym text (one group per line, comma- or "="-separated) → groups. */
export function parseSynonyms(text: string): string[][] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(/[,=]/)
        .map((t) => norm(t))
        .filter((t) => t.length > 0)
    )
    .filter((g) => g.length >= 2)
    .map((g) => Array.from(new Set(g)));
}

/** Lowercase, plain letters/digits/apostrophes, single spaces. */
export function norm(s: string): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' -]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pure: split what was typed into terms (quoted phrases stay together). */
export function tokenize(q: string): { terms: QueryTerm[]; exclude: string[] } {
  const terms: QueryTerm[] = [];
  const exclude: string[] = [];
  const re = /(-?)"([^"]+)"|(-?)(\S+)/g;
  let m: RegExpExecArray | null;
  const raw = String(q ?? "").slice(0, 200);
  while ((m = re.exec(raw))) {
    if (m[2] != null) {
      const t = norm(m[2]);
      if (!t) continue;
      if (m[1]) exclude.push(t);
      else terms.push({ text: t, phrase: t.includes(" ") });
    } else {
      const neg = m[3] === "-" && (m[4] ?? "").length > 1;
      for (const t of norm(m[4] ?? "").split(" ").filter(Boolean)) {
        if (neg) exclude.push(t);
        else terms.push({ text: t, phrase: false });
      }
    }
  }
  return { terms, exclude };
}

/** Pure: terms + synonym groups → AND-groups of alternatives. Consecutive
 *  words that spell a synonym phrase ("university of alabama") are matched
 *  as one, longest first. */
export function parseQuery(q: string, synonyms: string[][] = []): ParsedQuery {
  const { terms, exclude } = tokenize(q);
  const lookup = new Map<string, string[]>();
  for (const g of synonyms) for (const t of g) lookup.set(t, Array.from(new Set([...(lookup.get(t) ?? []), ...g])));
  const groups: string[][] = [];
  let i = 0;
  while (i < terms.length && groups.length < MAX_GROUPS) {
    const t = terms[i];
    if (t.phrase) {
      groups.push(lookup.get(t.text) ?? [t.text]);
      i++;
      continue;
    }
    let matched = false;
    for (let len = Math.min(4, terms.length - i); len >= 2; len--) {
      const slice = terms.slice(i, i + len);
      if (slice.some((x) => x.phrase)) continue;
      const phrase = slice.map((x) => x.text).join(" ");
      const alts = lookup.get(phrase);
      if (alts) {
        groups.push(alts);
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    groups.push(lookup.get(t.text) ?? [t.text]);
    i++;
  }
  const words = terms.filter((t) => !t.phrase).map((t) => t.text);
  const text = terms.map((t) => t.text).join(" ");
  return { groups: groups.map((g) => Array.from(new Set(g))), exclude, words, text };
}

/** Pure: a prefix tsquery string for autocomplete ("birm" → 'birm':*),
 *  every word required, the last one as a prefix. Only plain words. */
export function prefixTsquery(q: string): string | null {
  const words = norm(q)
    .split(" ")
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 0)
    .slice(0, 6);
  if (!words.length) return null;
  return words.map((w, i) => (i === words.length - 1 ? `${w}:*` : w)).join(" & ");
}

/** Pure: "Did you mean" — replace each word that has a better-known
 *  neighbour; null when nothing changed. */
export function didYouMean(q: string, fixes: Map<string, string>): string | null {
  const { terms } = tokenize(q);
  let changed = false;
  const out = terms.map((t) => {
    if (t.phrase) return `"${t.text}"`;
    const f = fixes.get(t.text);
    if (f && f !== t.text) {
      changed = true;
      return f;
    }
    return t.text;
  });
  return changed ? out.join(" ") : null;
}
