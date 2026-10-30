// "Fit to 24" (pure): lay a lot's scans into eBay's 24 photos. Photo 1 is
// the cover; this plans photos 2–24. Todd, Oct 30 2026: merge single scans
// into 2–4-up photos only as much as needed so every scan shows, keep a
// piece's front and back together first, then merge neighbours; label the
// merged photos with the cover's piece numbers; a draft can be set to "solo
// photos only" (no merging); past what fits at 4 scans a photo, the last
// pieces are left off the listed photos (their scans stay on the draft).
// Tested in photo-fit-plan.test.mts; the pixels are photo-fit.ts.

import { balancedRows } from "./cover";

export const FIT_SLOTS = 23; // eBay's 24 minus the cover
export const FIT_MAX_PER_TILE = 4; // scans in one merged photo (2×2 at most)
export const FIT_MAX_PIECES = 60; // pieces one lot can hold

/** One piece of a lot: its number (as on the cover) and its scans, front first. */
export type FitPiece = { n: number; scans: string[] };
/** One listed photo after the cover. One scan = that original photo;
 *  more = a merged photo FIA makes. `labels` is the piece number to draw on
 *  each scan ("" = none: a piece's back next to its front). */
export type FitTile = { scans: string[]; pieces: number[]; labels: string[] };
export type FitPlan = {
  tiles: FitTile[];
  /** Pieces with no scan in the listed photos (still on the cover when it holds them). */
  dropped: number[];
  /** Scans that aren't a listed photo of their own (merged or left off). */
  parked: string[];
  merged: boolean;
};

type Opts = { slots?: number; maxPerTile?: number; prefer?: number[]; soloOnly?: boolean };

function tileOf(pieces: FitPiece[], scansOf: (p: FitPiece) => string[]): FitTile {
  const scans: string[] = [];
  const labels: string[] = [];
  for (const p of pieces) {
    scansOf(p).forEach((s, i) => {
      scans.push(s);
      labels.push(i === 0 ? String(p.n) : "");
    });
  }
  return { scans, pieces: pieces.map((p) => p.n), labels };
}

/** Pure: plan photos 2–24. `prefer` = piece numbers that should keep their
 *  own photo (best first); they go first, then the rest in number order. */
export function planFit(input: FitPiece[], opts: Opts = {}): FitPlan {
  const S = opts.slots ?? FIT_SLOTS;
  const M = opts.maxPerTile ?? FIT_MAX_PER_TILE;
  const pieces = input.filter((p) => p.scans.length);
  const byN = new Map(pieces.map((p) => [p.n, p]));
  const prefer = Array.from(new Set((opts.prefer ?? []).filter((n) => byN.has(n))));
  const ordered = [...prefer.map((n) => byN.get(n)!), ...pieces.filter((p) => !prefer.includes(p.n))];
  const allScans = ordered.flatMap((p) => p.scans);
  const finish = (tiles: FitTile[], merged: boolean): FitPlan => {
    const listed = new Set(tiles.filter((t) => t.scans.length === 1).map((t) => t.scans[0]));
    const shown = new Set(tiles.flatMap((t) => t.pieces));
    return {
      tiles,
      dropped: pieces.filter((p) => !shown.has(p.n)).map((p) => p.n),
      parked: allScans.filter((s) => !listed.has(s)),
      merged,
    };
  };
  const solo = (p: FitPiece, s: string, i: number): FitTile => ({ scans: [s], pieces: [p.n], labels: [i === 0 ? String(p.n) : ""] });

  // Everything fits as it is.
  if (allScans.length <= S) return finish(ordered.flatMap((p) => p.scans.map((s, i) => solo(p, s, i))), false);

  // Todd's "solo photos only": no merging. Every piece's front first, then
  // backs piece by piece, until the photos run out (listed in piece order).
  if (opts.soloOnly) {
    const priority = [...ordered.map((p) => p.scans[0]), ...ordered.flatMap((p) => p.scans.slice(1))];
    const keep = new Set(priority.slice(0, S));
    return finish(ordered.flatMap((p) => p.scans.map((s, i) => ({ s, i, p }))).filter((x) => keep.has(x.s)).map((x) => solo(x.p, x.s, x.i)), false);
  }

  // Each piece on one photo (front + back together; a piece with more scans
  // than one photo holds takes several), then give pieces their scans back
  // one by one, preferred / first pieces first, while photos are left.
  const chunks = (p: FitPiece) => Math.ceil(p.scans.length / M);
  const base = ordered.reduce((a, p) => a + chunks(p), 0);
  if (base <= S) {
    let spare = S - base;
    const split = new Set<number>();
    for (const p of ordered) {
      const cost = p.scans.length - chunks(p);
      if (cost > 0 && cost <= spare) {
        split.add(p.n);
        spare -= cost;
      }
    }
    const tiles: FitTile[] = [];
    for (const p of ordered) {
      if (split.has(p.n) || p.scans.length === 1) p.scans.forEach((s, i) => tiles.push(solo(p, s, i)));
      else for (let k = 0; k < p.scans.length; k += M) tiles.push(tileOf([p], () => p.scans.slice(k, k + M)));
    }
    return finish(tiles, true);
  }

  // More pieces than photos: neighbours share a photo (a piece is never cut
  // in two; one with more scans than a photo holds shows its first M).
  // Preferred pieces keep a photo each while the rest still fit; whatever
  // can't fit at M scans a photo is left off from the end.
  const cnt = (p: FitPiece) => Math.min(p.scans.length, M);
  const scansOf = (p: FitPiece) => p.scans.slice(0, M);
  const greedyGroups = (list: FitPiece[]) => {
    let groups = 0;
    let fill = M;
    for (const p of list) {
      if (fill + cnt(p) > M) {
        groups++;
        fill = 0;
      }
      fill += cnt(p);
    }
    return groups;
  };
  let keepSolo = prefer.length;
  while (keepSolo > 0 && greedyGroups(ordered.slice(keepSolo)) > S - keepSolo) keepSolo--;
  const solos = ordered.slice(0, keepSolo);
  let others = ordered.slice(keepSolo);
  const room = S - solos.length;
  while (others.length && greedyGroups(others) > room) others = others.slice(0, -1);
  const tiles: FitTile[] = solos.map((p) => tileOf([p], scansOf));
  if (others.length) {
    const rows = balancedRows(others.map(cnt), Math.min(room, others.length));
    for (const r of rows) tiles.push(tileOf(r.map((i) => others[i]), scansOf));
  }
  return finish(tiles, true);
}

/** Pure: plain words for where the pieces are (for Claude and the draft page). */
export function fitText(plan: FitPlan): string {
  const parts = plan.tiles.map((t, i) => {
    const who = Array.from(new Set(t.pieces)).map((n) => `#${n}`).join(" + ");
    return t.scans.length > 1 ? `photo ${i + 2}: ${who} (merged, ${t.scans.length} scans)` : `photo ${i + 2}: ${who}`;
  });
  return parts.join("; ");
}
