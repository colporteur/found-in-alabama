// Run: npx tsx --test lib/sales/readiness-core.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { dayRange, scoreDay, scoreVenue, type DayInput } from "./readiness-core";

const base = (day: string, over: Partial<DayInput> = {}): DayInput => ({
  day, sales: 0, unmatched: 0, missed: 0, legs: 0, legsDone: 0, legsNiftyFailed: 0,
  legsStillLiveOld: 0, legsOpen: 0, missedCheckCovered: true, ...over,
});

test("day states", () => {
  assert.equal(scoreDay(base("2026-10-01"), "2026-10-10").state, "clean");
  assert.equal(scoreDay(base("2026-10-01", { missed: 1 }), "2026-10-10").state, "problem");
  assert.equal(scoreDay(base("2026-10-01", { legsStillLiveOld: 2 }), "2026-10-10").why[0], "2 delists still listed a day later");
  assert.equal(scoreDay(base("2026-10-01", { legsOpen: 1 }), "2026-10-10").state, "unchecked");
  assert.equal(scoreDay(base("2026-10-01", { missedCheckCovered: false }), "2026-10-10").state, "unchecked");
  assert.equal(scoreDay(base("2026-10-10", { missed: 3 }), "2026-10-10").state, "today");
  // Nifty failing a delist doesn't count against FIA.
  assert.equal(scoreDay(base("2026-10-01", { legs: 1, legsNiftyFailed: 1 }), "2026-10-10").state, "clean");
});

test("streak counts clean days back from yesterday and stops at the first non-clean day", () => {
  const days = dayRange("2026-10-01", "2026-10-10").map((d) =>
    base(d, d === "2026-10-04" ? { unmatched: 1 } : d === "2026-10-10" ? { legsOpen: 5 } : {})
  );
  const s = scoreVenue(days, "2026-10-10");
  assert.equal(s.streak, 5); // Oct 5–9
  assert.equal(s.problems, 1);
  assert.equal(s.ready, false);
  const s2 = scoreVenue(dayRange("2026-09-01", "2026-10-10").map((d) => base(d)), "2026-10-10");
  assert.equal(s2.streak, 39);
  assert.equal(s2.ready, true);
});

test("dayRange", () => {
  assert.deepEqual(dayRange("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
});
