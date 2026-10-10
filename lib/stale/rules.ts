// Shake-up rhythm (Phase 5a) — pure rules, tested in rules.test.mts.
//
// Todd holds a long tail on purpose (ephemera can take years), so nothing
// here says "dump it". Every `cycleDays` (default 180) since its last
// shake-up, a live item comes due for ONE fresh action, rotating:
//   round 1  rewrite   new title + fill item specifics (AI, Expert Guides)
//   round 2  markdown  a small price cut, never below the floor
//   round 3  describe  a new description
//   round 4  markdown  …and the cycle repeats
// Cheap items that have already been through a couple of rounds become
// bundle candidates instead (a lot of several from the same bin sells
// where singles don't).

export type StaleSettings = {
  cycleDays: number;
  markdownPct: number;
  floor: number;
  /** At or below this price, after `bundleAfterRounds` rounds → bundle. */
  bundleMaxPrice: number;
  bundleAfterRounds: number;
  /** A bin needs this many bundle candidates to suggest a lot. */
  bundleMinItems: number;
};

export const DEFAULT_STALE_SETTINGS: StaleSettings = {
  cycleDays: 180,
  markdownPct: 10,
  floor: 5.87,
  bundleMaxPrice: 7.87,
  bundleAfterRounds: 2,
  bundleMinItems: 5,
};

const n = (v: unknown, d: number, min = 0, max = 100000) => {
  const x = Number(v);
  return Number.isFinite(x) && x >= min && x <= max ? x : d;
};

export function parseStaleSettings(raw: unknown): StaleSettings {
  const v = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULT_STALE_SETTINGS;
  return {
    cycleDays: Math.round(n(v.cycleDays, d.cycleDays, 30, 3650)),
    markdownPct: n(v.markdownPct, d.markdownPct, 1, 50),
    floor: n(v.floor, d.floor, 0.99, 1000),
    bundleMaxPrice: n(v.bundleMaxPrice, d.bundleMaxPrice, 0, 1000),
    bundleAfterRounds: Math.round(n(v.bundleAfterRounds, d.bundleAfterRounds, 0, 20)),
    bundleMinItems: Math.round(n(v.bundleMinItems, d.bundleMinItems, 2, 100)),
  };
}

export type StaleAction = "rewrite" | "markdown" | "describe" | "bundle";
const ROTATION: StaleAction[] = ["rewrite", "markdown", "describe", "markdown"];

/** Price after one markdown — the same math as the Enhance price_adjust op
 *  (percent, nearest .87, floor) — or null when it wouldn't actually lower
 *  the price (already at the floor). */
export function markdownPrice(price: number, s: StaleSettings): number | null {
  const raw = price * (1 - s.markdownPct / 100);
  const lower = Math.floor(raw) - 1 + 0.87;
  const upper = Math.floor(raw) + 0.87;
  let p = raw - lower <= upper - raw ? lower : upper;
  if (p < s.floor) p = s.floor;
  p = Math.round(p * 100) / 100;
  return p < price ? p : null;
}

/** The next action for an item that has had `rounds` shake-ups. */
export function nextAction(rounds: number, price: number | null, s: StaleSettings): StaleAction {
  const p = price ?? 0;
  if (p > 0 && p <= s.bundleMaxPrice && rounds >= s.bundleAfterRounds) return "bundle";
  let a = ROTATION[rounds % ROTATION.length];
  if (a === "markdown" && (p <= 0 || markdownPrice(p, s) == null)) {
    a = p > 0 && p <= s.bundleMaxPrice ? "bundle" : rounds % 2 === 0 ? "rewrite" : "describe";
  }
  return a;
}

/** Days until the item is due (≤ 0 = due now). */
export function daysUntilDue(lastShakeOrStart: Date | null, now: Date, s: StaleSettings): number {
  if (!lastShakeOrStart) return 0;
  const age = (now.getTime() - lastShakeOrStart.getTime()) / 86_400_000;
  return Math.ceil(s.cycleDays - age);
}
