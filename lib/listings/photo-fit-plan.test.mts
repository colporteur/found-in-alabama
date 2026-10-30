// Run: npx tsx --test lib/listings/photo-fit-plan.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { planFit, fitText, type FitPiece } from "./photo-fit-plan";

/** n pieces, each with `scans` scans named "<n>f", "<n>b", "<n>c"… */
function lot(n: number, scans = 2): FitPiece[] {
  return Array.from({ length: n }, (_, i) => ({ n: i + 1, scans: Array.from({ length: scans }, (_, k) => `${i + 1}${"fbcdefg"[k]}`) }));
}
const count = (plan: ReturnType<typeof planFit>) => plan.tiles.reduce((a, t) => a + t.scans.length, 0);

test("everything fits: every scan its own photo, nothing merged", () => {
  const p = planFit(lot(11, 2));
  assert.equal(p.tiles.length, 22);
  assert.equal(p.merged, false);
  assert.deepEqual(p.parked, []);
  assert.deepEqual(p.tiles[0].scans, ["1f"]);
  assert.deepEqual(p.tiles[1].scans, ["1b"]);
});

test("15 cards front+back: first pieces solo, the rest front+back together", () => {
  const p = planFit(lot(15, 2));
  assert.equal(p.tiles.length, 23);
  assert.equal(p.merged, true);
  assert.equal(count(p), 30);
  assert.deepEqual(p.dropped, []);
  // 15 piece photos + 8 spare → pieces 1–8 split, 9–15 merged front+back
  assert.deepEqual(p.tiles[0].scans, ["1f"]);
  assert.deepEqual(p.tiles.at(-1)!.scans, ["15f", "15b"]);
  assert.deepEqual(p.tiles.at(-1)!.labels, ["15", ""]);
  // a front and its back are never on different merged photos
  for (const t of p.tiles) if (t.scans.length > 1) assert.equal(new Set(t.pieces).size, 1);
});

test("23 cards front+back: each card one photo", () => {
  const p = planFit(lot(23, 2));
  assert.equal(p.tiles.length, 23);
  assert.ok(p.tiles.every((t) => t.scans.length === 2 && t.pieces.length === 1));
});

test("40 cards front+back: two cards (4 scans) a photo, none left off", () => {
  const p = planFit(lot(40, 2));
  assert.ok(p.tiles.length <= 23);
  assert.ok(p.tiles.every((t) => t.scans.length <= 4));
  assert.equal(count(p), 80);
  assert.deepEqual(p.dropped, []);
  // neighbours: pieces on a photo are consecutive
  for (const t of p.tiles) t.pieces.forEach((n, i) => i && assert.equal(n, t.pieces[i - 1] + 1));
});

test("60 cards front+back: what fits at 4 scans a photo shows, the last are left off", () => {
  const p = planFit(lot(60, 2));
  assert.equal(p.tiles.length, 23);
  assert.deepEqual(p.dropped, Array.from({ length: 14 }, (_, i) => 47 + i));
  assert.ok(p.parked.includes("60f"));
});

test("30 single scans (folder lot): neighbours share evenly, 2 at most", () => {
  const p = planFit(lot(30, 1));
  assert.equal(p.tiles.length, 23);
  assert.ok(p.tiles.every((t) => t.scans.length <= 2));
  assert.equal(count(p), 30);
});

test("preferred pieces keep their own photo and go first", () => {
  const p = planFit(lot(40, 1), { prefer: [7, 33, 7, 99] });
  assert.deepEqual(p.tiles[0].scans, ["7f"]);
  assert.deepEqual(p.tiles[1].scans, ["33f"]);
  assert.equal(count(p), 40);
  assert.ok(!p.tiles.slice(2).some((t) => t.pieces.includes(7) || t.pieces.includes(33)));
});

test("too many preferred pieces: only as many as still let the rest fit", () => {
  const p = planFit(lot(60, 1), { prefer: Array.from({ length: 22 }, (_, i) => i + 1) });
  assert.equal(p.tiles.length, 23);
  assert.deepEqual(p.dropped, []);
  assert.equal(count(p), 60);
});

test("solo photos only: no merging, fronts first, the rest wait", () => {
  const p = planFit(lot(15, 2), { soloOnly: true });
  assert.equal(p.tiles.length, 23);
  assert.equal(p.merged, false);
  assert.ok(p.tiles.every((t) => t.scans.length === 1));
  // all 15 fronts listed, 8 backs
  for (let n = 1; n <= 15; n++) assert.ok(p.tiles.some((t) => t.scans[0] === `${n}f`));
  assert.ok(p.parked.includes("15b"));
  assert.deepEqual(p.dropped, []);
});

test("a piece with many scans is cut into photos of 4", () => {
  const p = planFit([{ n: 1, scans: ["a", "b", "c", "d", "e", "f"] }, ...lot(20, 1).map((x) => ({ ...x, n: x.n + 1 }))]);
  assert.ok(p.tiles.length <= 23);
  assert.equal(count(p), 26);
  // too crowded to cut: every piece still shows, the big one by its first 4
  const q = planFit([{ n: 1, scans: ["a", "b", "c", "d", "e", "f"] }, ...lot(30, 1).map((x) => ({ ...x, n: x.n + 1 }))]);
  assert.deepEqual(q.dropped, []);
  assert.ok(q.parked.includes("f"));
});

test("fitText names merged photos", () => {
  const t = fitText(planFit(lot(30, 1)));
  assert.match(t, /^photo 2: /);
  assert.match(t, /merged, 2 scans/);
});
