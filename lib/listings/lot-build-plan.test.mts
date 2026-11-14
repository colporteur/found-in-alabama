// Run: npx tsx --test lib/listings/lot-build-plan.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { checkPlan, cleanIdentify, cleanPlan, lotInstructions, needsLook, nextLotNo, pullInstructions, sheetPages, sortingGuide, type PieceLite } from "./lot-build-plan";
import { parseIntakeRequest } from "./validate";

const piece = (n: number, over: Partial<PieceLite> = {}): PieceLite => ({ n, state: "sorting", verdict: null, lotNo: null, locked: false, ...over });
const sha = (i: number) => i.toString(16).padStart(64, "0");

test("identify: a pull needs a reason, a photo request needs to say which photo", () => {
  const known = new Set([1, 2, 3, 4]);
  const r = cleanIdentify(
    [
      { n: 1, identification: "  Miles Davis –  Kind of Blue, Columbia CL 1355 ", est_value_usd: 40, verdict: "pull", reason: "six-eye mono label" },
      { n: 2, verdict: "pull" },
      { n: 3, verdict: "need_photo" },
      { n: 4, verdict: "need_photo", photo_request: "label, side 1" },
      { n: 9, verdict: "lot" },
      { n: 1, verdict: "lot" },
    ],
    known
  );
  assert.deepEqual(r.ok.map((x) => x.n), [1, 4]);
  assert.equal(r.ok[0].identification, "Miles Davis – Kind of Blue, Columbia CL 1355");
  assert.equal(r.ok[0].estValue, 40);
  assert.equal(r.ok[1].photoRequest, "label, side 1");
  assert.equal(r.errors.length, 4);
  assert.match(r.errors.join("|"), /#2: a pull needs a reason/);
  assert.match(r.errors.join("|"), /#3: need_photo needs photo_request/);
  assert.match(r.errors.join("|"), /#9: no such piece/);
  assert.match(r.errors.join("|"), /#1: listed twice/);
});

test("identify: a bad verdict is refused, a missing one is kept as 'no change'", () => {
  const r = cleanIdentify([{ n: 1, verdict: "keep" }, { n: 2, identification: "Jim Reeves LP" }], new Set([1, 2]));
  assert.equal(r.ok.length, 1);
  assert.equal(r.ok[0].verdict, null);
  assert.equal(r.errors.length, 1);
});

test("plan: a piece goes in one lot; unknown pieces and numbers are errors", () => {
  const { lots } = cleanPlan([
    { name: "Southern gospel quartets", pieces: [1, 2, 3, 3] },
    { name: "Country", pieces: [3, 4, 99] },
    { no: 7, name: "Ghost", pieces: [5, 6] },
    { pieces: [1] },
  ]);
  assert.equal(lots.length, 3);
  assert.deepEqual(lots[0].pieces, [1, 2, 3]);
  const c = checkPlan(lots, [1, 2, 3, 4, 5, 6].map((n) => piece(n)), [{ no: 1, status: "proposed" }]);
  assert.match(c.errors.join("|"), /#3 is in two lots/);
  assert.match(c.errors.join("|"), /#99 isn't a piece/);
  assert.match(c.errors.join("|"), /lot 7: no such lot number/);
});

test("plan: Todd's placements and built pieces stay where they are", () => {
  const pieces = [piece(1), piece(2, { locked: true, lotNo: 2, verdict: "lot" }), piece(3, { state: "in_lot", lotNo: 1 }), piece(4, { locked: true, verdict: "pull" }), piece(5)];
  const { lots } = cleanPlan([{ name: "Easy listening", pieces: [1, 2, 3, 4, 5] }, { no: 2, name: "Gospel", pieces: [2] }]);
  const c = checkPlan(lots, pieces, [{ no: 1, status: "built" }, { no: 2, status: "proposed" }]);
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.lots[0].pieces, [1, 5]);
  assert.deepEqual(c.lots[1].pieces, [2]); // a locked piece may stay in the lot Todd put it in
  assert.equal(c.skipped.length, 3);
  assert.match(c.skipped.join("|"), /#4 \(Todd placed it as a pull\)/);
  assert.match(c.warnings.join("|"), /"Gospel" has one piece/);
});

test("plan: a built lot can't be revised, and 60 is the most a lot holds", () => {
  const many = Array.from({ length: 61 }, (_, i) => piece(i + 1));
  const big = checkPlan(cleanPlan([{ name: "Everything", pieces: many.map((p) => p.n) }]).lots, many, []);
  assert.match(big.errors.join("|"), /61 pieces; a lot holds at most 60/);
  const built = checkPlan(cleanPlan([{ no: 1, name: "X", pieces: [1, 2] }]).lots, many, [{ no: 1, status: "built" }]);
  assert.match(built.errors.join("|"), /lot 1 is already built/);
});

test("lot numbers are never reused, even after a lot is dissolved", () => {
  assert.equal(nextLotNo([]), 1);
  assert.equal(nextLotNo([1, 2, 3]), 4);
  assert.equal(nextLotNo([1, 5]), 6);
});

test("contact sheets: pages of piece numbers from a starting piece", () => {
  const ns = Array.from({ length: 40 }, (_, i) => i + 1);
  assert.deepEqual(sheetPages(ns, 1, 18, 9), [ns.slice(0, 9), ns.slice(9, 18)]);
  assert.deepEqual(sheetPages(ns, 37, 18, 9), [[37, 38, 39, 40]]);
  assert.deepEqual(sheetPages([3, 8, 9, 20], 5, 4, 4), [[8, 9, 20]]);
  assert.equal(sheetPages(ns, 1, 100, 50)[0].length, 16); // capped per sheet
  assert.equal(sheetPages(ns, 1, 100, 16).flat().length, 32); // capped per call
  assert.deepEqual(sheetPages(ns, 41, 9, 9), []);
});

test("sorting guide: every piece, in number order, with its pile", () => {
  const g = sortingGuide(
    [
      piece(3, { verdict: "pull", identification: "Sealed Stax LP" }),
      piece(1, { verdict: "lot", lotNo: 2 }),
      piece(2, { verdict: "need_photo" }),
      piece(4),
      piece(5, { state: "removed" }),
      piece(6, { state: "in_lot", lotNo: 1 }),
      piece(7, { state: "pulled" }),
    ],
    new Map([[1, "Country"], [2, "Gospel quartets"]])
  );
  assert.deepEqual(g.map((r) => r.n), [1, 2, 3, 4, 6, 7]);
  assert.equal(g[0].where, "Lot 2 — Gospel quartets");
  assert.equal(g[1].kind, "photo");
  assert.equal(g[2].kind, "pull");
  assert.equal(g[2].what, "Sealed Stax LP");
  assert.equal(g[3].kind, "none");
  assert.equal(g[4].kind, "done");
  assert.equal(g[5].kind, "pull");
});

test("a piece waits for Claude until looked at, and again when Todd adds a photo", () => {
  assert.equal(needsLook({ lookedAt: null, photos: 1, photosSeen: 0, state: "sorting" }), true);
  assert.equal(needsLook({ lookedAt: "2026-11-14", photos: 1, photosSeen: 1, state: "sorting" }), false);
  assert.equal(needsLook({ lookedAt: "2026-11-14", photos: 2, photosSeen: 1, state: "sorting" }), true);
  assert.equal(needsLook({ lookedAt: null, photos: 1, photosSeen: 0, state: "in_lot" }), false);
});

test("instructions carried onto built lots and pulls", () => {
  const build = { name: "Estate LPs box 3", kind: "LP records" };
  const lot = lotInstructions(
    { no: 2, name: "Southern gospel quartets", reason: "one genre; guide: lot by one genre", suggestedPrice: 24, guideId: "gospel-and-private-press-vinyl" },
    build,
    [{ n: 14, identification: "Blackwood Brothers – On Tour, RCA LPM-2752", estValue: 9 }, { n: 3, identification: null, estValue: null }]
  );
  assert.match(lot, /lot 2, "Southern gospel quartets"/);
  assert.match(lot, /1\. Blackwood Brothers – On Tour, RCA LPM-2752 \(alone ≈ \$9\) \[sort #14\]/);
  assert.match(lot, /2\. not identified \[sort #3\]/);
  assert.match(lot, /\$24/);
  const pull = pullInstructions({ n: 7, identification: "Sealed LP", estValue: 30, reason: "still sealed" }, build);
  assert.match(pull, /piece #7/);
  assert.match(pull, /still sealed/);
});

test("intake: after.lotBuild makes the draft a piece of a sort session", () => {
  const base = { source: "scans", photos: [{ name: "a.jpg", sha256: sha(1), bytes: 10, contentType: "image/jpeg" }] };
  const ok = parseIntakeRequest({ ...base, after: { lotBuild: { key: "lb-20261114-lps", name: "Estate LPs", kind: "LP records", n: 12 } } });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.value.after, { claude: null, lotBuild: { key: "lb-20261114-lps", name: "Estate LPs", kind: "LP records", n: 12 } });
  }
  const noName = parseIntakeRequest({ ...base, after: { lotBuild: { key: "k1" } } });
  assert.equal(noName.ok && noName.value.after.lotBuild?.name, "k1");
  assert.equal(noName.ok && noName.value.after.lotBuild?.n, null);
  const bad = parseIntakeRequest({ ...base, after: { lotBuild: { key: "has spaces" } } });
  assert.equal(bad.ok, false);
  // Unchanged: the older "after" shapes.
  const claude = parseIntakeRequest({ ...base, after: { claude: { lots: true, batch: "b1" } } });
  assert.deepEqual(claude.ok && claude.value.after, { claude: { lots: true, batch: "b1" } });
});
