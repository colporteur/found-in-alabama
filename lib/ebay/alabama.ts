// Heuristics for detecting whether a piece of text — a store category name, a
// listing title, or a description — references Alabama. The output is a list
// of matched groups; we use it both to flag store categories at sync time
// and to give Claude a starting hint when classifying listings.
//
// Adding a term: drop it into the appropriate group's `patterns` array. Use
// `\b` word boundaries to avoid false matches inside larger words.

export interface KeywordGroup {
  /** Short label used in UI ("City", "University", etc.). */
  label: string;
  /** Tier: "strong" matches usually mean the item really is Alabama-related;
   *  "weak" matches are hints that need corroboration (e.g. "Mobile" might be
   *  the city or might be the adjective). */
  tier: "strong" | "weak";
  patterns: RegExp[];
}

export const ALABAMA_KEYWORDS: KeywordGroup[] = [
  {
    label: "Direct",
    tier: "strong",
    patterns: [
      /\balabama\b/i,
      /\bbama\b/i,
      /heart of dixie/i,
      /yellowhammer/i,
      /sweet home alabama/i,
      // "AL" alone is too noisy; require it to be in a USPS-style address pattern
      /,\s*AL\b/,
      /\bAL\s+\d{5}\b/,
    ],
  },
  {
    label: "City",
    tier: "strong",
    patterns: [
      /\bbirmingham\b/i,
      /\bmontgomery\b/i,
      /\bhuntsville\b/i,
      /\btuscaloosa\b/i,
      /\bauburn\b/i,
      /\bdothan\b/i,
      /\bdecatur\b/i,
      /\bgadsden\b/i,
      /\banniston\b/i,
      /\bflorence\b/i,
      /\bselma\b/i,
      /\bopelika\b/i,
      /\bprattville\b/i,
      /\bvestavia\b/i,
      /\bhomewood\b/i,
      /\bfairhope\b/i,
    ],
  },
  {
    label: "City (ambiguous)",
    tier: "weak",
    // These cities exist outside Alabama too, so we tier them as weak.
    patterns: [/\bmobile\b/i, /\bmadison\b/i, /\bathens\b/i, /\btroy\b/i],
  },
  {
    label: "University",
    tier: "strong",
    patterns: [
      /crimson tide/i,
      /roll tide/i,
      /\bU\s*of\s*A\b/i,
      /alabama crimson/i,
      /auburn tigers?/i,
      /war eagle/i,
      /UAB blazers?/i,
      /troy trojans?/i,
      /alabama A\s*&\s*M/i,
      /tuskegee/i,
      /samford bulldogs?/i,
      /south alabama jaguars?/i,
    ],
  },
  {
    label: "History",
    tier: "strong",
    patterns: [
      /civil rights/i,
      /tuskegee airmen/i,
      /selma march/i,
      /scottsboro/i,
      /george wallace/i,
    ],
  },
  {
    label: "History (ambiguous)",
    tier: "weak",
    patterns: [/confederate/i, /\bdixie\b/i],
  },
  {
    label: "Author / Figure",
    tier: "strong",
    patterns: [
      /harper lee/i,
      /to kill a mockingbird/i,
      /helen keller/i,
      /jesse owens/i,
      /hank williams/i,
      /rosa parks/i,
      /\bMLK\b/,
      /martin luther king/i,
      /condoleezza rice/i,
      /willie mays/i,
      /\bhank aaron\b/i,
      /satchel paige/i,
    ],
  },
];

export interface AlabamaMatch {
  label: string;
  tier: "strong" | "weak";
  matched: string;
}

/**
 * Find every keyword group that matches the input text. Returns at most one
 * match per group (the first regex that hits) — we don't need a full list of
 * every occurrence, just whether the group fired.
 */
export function detectAlabamaMatches(text: string | null | undefined): AlabamaMatch[] {
  if (!text) return [];
  const matches: AlabamaMatch[] = [];
  for (const group of ALABAMA_KEYWORDS) {
    for (const pat of group.patterns) {
      const m = text.match(pat);
      if (m) {
        matches.push({ label: group.label, tier: group.tier, matched: m[0] });
        break;
      }
    }
  }
  return matches;
}

export interface AlabamaScore {
  isAlabamaRelated: boolean;
  strongMatches: AlabamaMatch[];
  weakMatches: AlabamaMatch[];
}

/**
 * Score a piece of text for Alabama-ness. We treat it as Alabama-related when
 * any strong match fires, OR when at least two weak matches fire (one weak
 * match alone is too noisy).
 */
export function scoreAlabama(text: string | null | undefined): AlabamaScore {
  const all = detectAlabamaMatches(text);
  const strong = all.filter((m) => m.tier === "strong");
  const weak = all.filter((m) => m.tier === "weak");
  return {
    isAlabamaRelated: strong.length >= 1 || weak.length >= 2,
    strongMatches: strong,
    weakMatches: weak,
  };
}
