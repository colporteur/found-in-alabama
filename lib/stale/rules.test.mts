// Run: npx tsx --test lib/stale/rules.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STALE_SETTINGS as S, daysUntilDue, markdownPrice, nextAction, parseStaleSettings } from "./rules";

test("markdown cuts to .87 and respects the floor", () => {
  assert.equal(markdownPrice(14.87, S), 13.87);
  assert.equal(markdownPrice(29.87, S), 26.87);
  assert.equal(markdownPrice(9.87, S), 8.87);
  assert.equal(markdownPrice(6.87, S), 5.87);
  assert.equal(markdownPrice(5.87, S), null);
});

test("rotation: rewrite → markdown → describe → markdown, cheap items bundle", () => {
  assert.equal(nextAction(0, 19.87, S), "rewrite");
  assert.equal(nextAction(1, 19.87, S), "markdown");
  assert.equal(nextAction(2, 19.87, S), "describe");
  assert.equal(nextAction(3, 19.87, S), "markdown");
  assert.equal(nextAction(4, 19.87, S), "rewrite");
  assert.equal(nextAction(0, 6.87, S), "rewrite");
  assert.equal(nextAction(2, 6.87, S), "bundle");
  assert.equal(nextAction(1, 5.87, S), "bundle"); // can't mark down below the floor
});

test("due timing and settings parsing", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  assert.equal(daysUntilDue(new Date("2026-04-01T12:00:00Z"), now, S), -11);
  assert.equal(daysUntilDue(new Date("2026-09-09T12:00:00Z"), now, S), 150);
  assert.equal(daysUntilDue(null, now, S), 0);
  assert.equal(parseStaleSettings({ cycleDays: 5, markdownPct: "15" }).cycleDays, 180);
  assert.equal(parseStaleSettings({ markdownPct: "15" }).markdownPct, 15);
});
