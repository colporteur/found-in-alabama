// Run: npx tsx --test lib/listings/lot-build-plan.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { checkPlan, cleanIdentify, cleanPlan, lotInstructions, needsLook, nextLotNo, previewBucket, previewSummary, pullInstructions, sheetPages, sortingGuide, PREVIEW_DISCARD_MAX, PREVIEW_SINGLE_MIN, type PieceLite } from "./lot-build-plan";
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

// ─── Preview Mode ────────────────────────────────────────────────────────────

test("preview: pool and discard are only verdicts in a preview session", () => {
  const known = new Set([1, 2, 3, 4]);
  const input = [
    { n: 1, verdict: "pool", reason: "would suit a Birmingham advertising lot" },
    { n: 2, verdict: "discard", reason: "common, torn, under $1" },
    { n: 3, verdict: "discard" },
    { n: 4, verdict: "pool" },
  ];
  const lots = cleanIdentify(input, known);
  assert.equal(lots.ok.length, 0);
  assert.match(lots.errors.join("|"), /#1: verdict must be lot, pull or need_photo/);

  const pv = cleanIdentify(input, known, "preview");
  assert.deepEqual(pv.ok.map((x) => [x.n, x.verdict]), [[1, "pool"], [2, "discard"], [4, "pool"]]);
  assert.equal(pv.errors.length, 1);
  assert.match(pv.errors[0], /#3: a discard needs a reason/);
  assert.equal(pv.ok[1].reason, "common, torn, under $1");
});

test("preview: thresholds are $10 for a single and $2 for a discard", () => {
  assert.equal(PREVIEW_SINGLE_MIN, 10);
  assert.equal(PREVIEW_DISCARD_MAX, 2);
});

test("preview: every piece lands in one pile, before and after it is sent on", () => {
  const ps: PieceLite[] = [
    piece(1, { verdict: "pull", estValue: 14 }),
    piece(2, { verdict: "lot", lotNo: 1, estValue: 3 }),
    piece(3, { verdict: "lot", lotNo: 1, estValue: 4 }),
    piece(4, { verdict: "pool", estValue: 2.5 }),
    piece(5, { verdict: "discard", estValue: 0.5 }),
    piece(6, { verdict: "need_photo" }),
    piece(7),
    piece(8, { verdict: "lot" }),
    piece(9, { state: "pooled", verdict: "pool", estValue: 3 }),
    piece(10, { state: "discarded", verdict: "discard", estValue: 1 }),
    piece(11, { state: "pulled", verdict: "pull", estValue: 20 }),
    piece(12, { state: "in_lot", verdict: "lot", lotNo: 2, estValue: 5 }),
    piece(13, { state: "removed", estValue: 99 }),
  ];
  assert.deepEqual(ps.map(previewBucket), ["single", "lot", "lot", "pool", "discard", "look", "undecided", "undecided", "pool", "discard", "single", "lot", null]);
  const r = previewSummary(ps);
  assert.deepEqual(r.single, { pieces: 2, est: 34 });
  assert.deepEqual(r.lot, { pieces: 3, est: 12 });
  assert.deepEqual(r.pool, { pieces: 2, est: 5.5 });
  assert.deepEqual(r.discard, { pieces: 2, est: 1.5 });
  assert.equal(r.look.pieces, 1);
  assert.equal(r.undecided.pieces, 2);
  assert.equal(Object.values(r).reduce((a, x) => a + x.pieces, 0), 12);
});

test("preview: the sorting guide names the lot pool bin and the discard pile", () => {
  const g = sortingGuide([piece(1, { verdict: "pool" }), piece(2, { verdict: "discard" }), piece(3, { state: "pooled", verdict: "pool" }), piece(4, { state: "discarded", verdict: "discard" })], new Map());
  assert.deepEqual(g.map((r) => r.kind), ["pool", "discard", "pool", "discard"]);
  assert.equal(g[0].where, "LOT POOL bin");
  assert.equal(g[1].where, "DISCARD");
});

test("preview: a plan leaves pieces Todd put in the pool or discards where they are", () => {
  const ps = [piece(1), piece(2), piece(3, { locked: true, verdict: "pool" }), piece(4, { locked: true, verdict: "discard" })];
  const c = checkPlan([{ no: null, name: "Alabama trade cards", pieces: [1, 2, 3, 4], reason: null, suggestedPrice: 12, guideId: null }], ps, []);
  assert.deepEqual(c.lots[0].pieces, [1, 2]);
  assert.match(c.skipped.join("|"), /#3 \(Todd placed it in the lot pool\)/);
  assert.match(c.skipped.join("|"), /#4 \(Todd placed it in discards\)/);
});

test("preview: a single's instructions say it came from a preview", () => {
  const t = pullInstructions({ n: 7, identification: "1908 RPPC, Lineville depot", estValue: 18, reason: "real photo, named small-town depot" }, { name: "Box 4", kind: null, mode: "preview" });
  assert.match(t, /Preview session "Box 4", piece #7/);
  assert.doesNotMatch(t, /Lot Builder/);
});

test("intake: after.lotBuild carries the preview mode, and only that value", () => {
  const body = (mode: unknown) => ({ source: "scans", photos: [{ name: "a.jpg", sha256: sha(1), bytes: 10, contentType: "image/jpeg" }], after: { lotBuild: { key: "pv-box-4-abc123", name: "Box 4", n: 3, mode } } });
  const a = parseIntakeRequest(body("preview"));
  assert.ok(a.ok && a.value.after.lotBuild?.mode === "preview" && a.value.after.lotBuild.n === 3);
  const b = parseIntakeRequest(body("anything"));
  assert.ok(b.ok && b.value.after.lotBuild && b.value.after.lotBuild.mode === undefined);
});
