// Sale → registry item matching rules (Phase SALES-1). Pure, so the rules
// are unit-tested (lib/sales/match.test.mts); the SQL that fetches the
// candidates lives in lib/sales/pipeline.ts.
//
// Title matching only runs when there's no exact id. Candidates are tiered so
// an item actually linked to the selling venue always beats a same-titled
// item that isn't; within a tier, price breaks ties. Anything still tied goes
// to the review queue — a wrong automatic match is worse than a manual one.

export type Candidate = {
  registryItemId: string;
  /** registry_items.status (live | sold | …). */
  itemStatus: string;
  /** Status of this item's listing on the selling venue; null = no listing there. */
  venueStatus: string | null;
  /** Known asking prices (Nifty capture price, eBay mirror price). */
  prices: number[];
};

export type MatchDecision =
  | { status: "matched"; registryItemId: string; tier: number; byPrice: boolean }
  | { status: "ambiguous"; candidateIds: string[] }
  | { status: "unmatched" };

const PRICE_EPSILON = 0.01;

/** Collapse duplicate rows (one per venue listing) to one per item, keeping
 *  the most useful venue status (live > unknown > sold > ended > none). */
export function dedupeCandidates(rows: Candidate[]): Candidate[] {
  const rank = (s: string | null) =>
    s === "live" ? 4 : s === "unknown" ? 3 : s === "sold" ? 2 : s === "ended" ? 1 : 0;
  const byId = new Map<string, Candidate>();
  for (const r of rows) {
    const prev = byId.get(r.registryItemId);
    if (!prev) {
      byId.set(r.registryItemId, { ...r, prices: [...r.prices] });
      continue;
    }
    if (rank(r.venueStatus) > rank(prev.venueStatus)) prev.venueStatus = r.venueStatus;
    for (const p of r.prices) if (!prev.prices.includes(p)) prev.prices.push(p);
  }
  return Array.from(byId.values());
}

function tierOf(c: Candidate): number {
  const linked = c.venueStatus !== null;
  const live = c.itemStatus === "live";
  if (linked && live) return 1; // listed on this venue and still for sale
  if (linked) return 2; // listed on this venue (already marked sold/ended)
  if (live) return 3; // for sale, but no known listing on this venue
  return 4;
}

/** For an old sale (history, backfill) the right item has usually already
 *  been recorded as sold, and a live same-titled item is a relist or more
 *  stock — so sold beats live. */
function historicalTierOf(c: Candidate): number {
  const linked = c.venueStatus !== null;
  const sold = c.itemStatus === "sold";
  if (linked && c.venueStatus === "sold") return 1; // sold on this very venue
  if (linked && sold) return 2;
  if (linked) return 3;
  if (sold) return 4;
  return 5;
}

export function pickCandidate(
  rows: Candidate[],
  price: number | null,
  opts: { historical?: boolean } = {}
): MatchDecision {
  const cands = dedupeCandidates(rows);
  if (cands.length === 0) return { status: "unmatched" };
  const tierOf_ = opts.historical ? historicalTierOf : tierOf;
  for (let tier = 1; tier <= 5; tier++) {
    const inTier = cands.filter((c) => tierOf_(c) === tier);
    if (inTier.length === 0) continue;
    if (inTier.length === 1) {
      return { status: "matched", registryItemId: inTier[0].registryItemId, tier, byPrice: false };
    }
    if (price != null) {
      const priced = inTier.filter((c) => c.prices.some((p) => Math.abs(p - price) < PRICE_EPSILON));
      if (priced.length === 1) {
        return { status: "matched", registryItemId: priced[0].registryItemId, tier, byPrice: true };
      }
    }
    return { status: "ambiguous", candidateIds: inTier.map((c) => c.registryItemId) };
  }
  return { status: "unmatched" };
}

/** LIKE pattern for a title prefix, with %, _ and \ escaped. */
export function likePrefix(normalized: string): string {
  return normalized.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
}
