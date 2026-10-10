// Delist readiness (Phase 2 → Phase 7): pure day-by-day scoring, tested in
// readiness-core.test.mts. The loader is readiness.ts.
//
// The Phase 7 test for leaving Nifty on a venue: 30+ days in a row where
// FIA saw every sale, matched it, and every delist it planned on that venue
// is confirmed (Nifty took it down, or Nifty's own failure email shows FIA's
// plan was right). A day is:
//   clean       — nothing wrong and everything checked (a quiet day counts)
//   problem     — a sale FIA missed or couldn't match, or a planned delist
//                 still listed a day later
//   unchecked   — a delist not confirmed yet, or no Nifty sales check
//                 covering the day yet (can't tell whether a sale was missed)
//   today       — still in progress, not scored

export type DayInput = {
  day: string; // YYYY-MM-DD, US Central
  sales: number;
  unmatched: number; // sales FIA couldn't tie to an item
  missed: number; // sales Nifty recorded that FIA never saw
  legs: number;
  legsDone: number;
  legsNiftyFailed: number; // Nifty failed; FIA's plan was right
  legsStillLiveOld: number; // still listed > 24 h after the plan
  legsOpen: number; // pending / unverified / still live < 24 h
  missedCheckCovered: boolean; // a Nifty sales check ran after this day
};

export type DayState = "clean" | "problem" | "unchecked" | "today";

export type ScoredDay = DayInput & { state: DayState; why: string[] };

export function scoreDay(d: DayInput, today: string): ScoredDay {
  if (d.day >= today) return { ...d, state: "today", why: [] };
  const why: string[] = [];
  if (d.missed) why.push(`${d.missed} sale${d.missed === 1 ? "" : "s"} FIA missed`);
  if (d.unmatched) why.push(`${d.unmatched} sale${d.unmatched === 1 ? "" : "s"} not matched to an item`);
  if (d.legsStillLiveOld) why.push(`${d.legsStillLiveOld} delist${d.legsStillLiveOld === 1 ? "" : "s"} still listed a day later`);
  if (why.length) return { ...d, state: "problem", why };
  const open: string[] = [];
  if (d.legsOpen) open.push(`${d.legsOpen} delist${d.legsOpen === 1 ? "" : "s"} not confirmed yet`);
  if (!d.missedCheckCovered) open.push("no Nifty sales check since");
  if (open.length) return { ...d, state: "unchecked", why: open };
  return { ...d, state: "clean", why: [] };
}

export const READY_DAYS = 30;

export type VenueScore = {
  days: ScoredDay[];
  /** Clean days in a row, counting back from yesterday. */
  streak: number;
  clean: number;
  problems: number;
  unchecked: number;
  ready: boolean;
};

export function scoreVenue(days: DayInput[], today: string): VenueScore {
  const scored = days.map((d) => scoreDay(d, today)).sort((a, b) => a.day.localeCompare(b.day));
  let streak = 0;
  for (let i = scored.length - 1; i >= 0; i--) {
    const s = scored[i].state;
    if (s === "today") continue;
    if (s !== "clean") break;
    streak++;
  }
  const count = (st: DayState) => scored.filter((d) => d.state === st).length;
  return { days: scored, streak, clean: count("clean"), problems: count("problem"), unchecked: count("unchecked"), ready: streak >= READY_DAYS };
}

/** Every calendar day from start to end inclusive (YYYY-MM-DD). */
export function dayRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  while (d <= e && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
