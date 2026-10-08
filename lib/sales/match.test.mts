// Run: npx tsx --test lib/sales/match.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { pickCandidate, dedupeCandidates, likePrefix, type Candidate } from "./match";

const c = (id: string, itemStatus: string, venueStatus: string | null, prices: number[] = []): Candidate => ({
  registryItemId: id,
  itemStatus,
  venueStatus,
  prices,
});

test("no candidates → unmatched", () => {
  assert.deepEqual(pickCandidate([], 5), { status: "unmatched" });
});

test("one candidate → matched whatever its tier", () => {
  assert.deepEqual(pickCandidate([c("a", "sold", null)], null), {
    status: "matched",
    registryItemId: "a",
    tier: 4,
    byPrice: false,
  });
});

test("a live item listed on the venue beats same-titled items elsewhere", () => {
  const r = pickCandidate([c("a", "live", "live"), c("b", "live", null), c("c", "sold", "sold")], null);
  assert.deepEqual(r, { status: "matched", registryItemId: "a", tier: 1, byPrice: false });
});

test("ties inside a tier are broken by price", () => {
  const r = pickCandidate([c("a", "live", "live", [10]), c("b", "live", "unknown", [12.5])], 12.5);
  assert.deepEqual(r, { status: "matched", registryItemId: "b", tier: 1, byPrice: true });
});

test("ties the price can't break go to review", () => {
  const r = pickCandidate([c("a", "live", "live", [10]), c("b", "live", "live", [10])], 10);
  assert.deepEqual(r, { status: "ambiguous", candidateIds: ["a", "b"] });
  const r2 = pickCandidate([c("a", "live", "live"), c("b", "live", "live")], null);
  assert.equal(r2.status, "ambiguous");
});

test("rows for the same item (several venue listings) count once", () => {
  const rows = [c("a", "live", "ended", [5]), c("a", "live", "live", [6]), c("b", "live", null)];
  const d = dedupeCandidates(rows);
  assert.equal(d.length, 2);
  assert.equal(d[0].venueStatus, "live");
  assert.deepEqual(d[0].prices, [5, 6]);
  assert.deepEqual(pickCandidate(rows, null), { status: "matched", registryItemId: "a", tier: 1, byPrice: false });
});

test("likePrefix escapes LIKE wildcards", () => {
  assert.equal(likePrefix("100% cotton_tee"), "100\\% cotton\\_tee%");
});
