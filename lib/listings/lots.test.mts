// Run: npx tsx --test lib/listings/lots.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { layoutCover, balancedRows } from "./cover";
import { frontOf, lotOrder } from "./lots";

const p = (id: string, position: number, role: string | null, draftId = "a") => ({ id, draftId, position, role });

test("cover tiles stay inside the square and don't overlap", () => {
  for (const aspects of [[1.5, 1.5], [0.7, 0.7, 1.4], [1.5, 0.66, 1.5, 0.66, 3, 1], Array(23).fill(1.4)]) {
    const tiles = layoutCover(aspects, 1600);
    assert.equal(tiles.length, aspects.length);
    for (const t of tiles) {
      assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= 1601 && t.y + t.h <= 1601, JSON.stringify(t));
      // keeps its shape (no cropping): within a pixel or two of the aspect
      assert.ok(Math.abs(t.w / t.h - aspects[t.index]) < 0.05, `aspect ${t.w / t.h} vs ${aspects[t.index]}`);
    }
    for (const a of tiles) for (const b of tiles) {
      if (a === b) continue;
      const apart = a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1 || a.y + a.h <= b.y + 1 || b.y + b.h <= a.y + 1;
      assert.ok(apart, `overlap ${JSON.stringify(a)} ${JSON.stringify(b)}`);
    }
  }
});

test("two landscape fronts sit side by side or stacked, equal size", () => {
  const t = layoutCover([1.5, 1.5]);
  assert.equal(Math.abs(t[0].w - t[1].w) <= 1, true);
  assert.deepEqual(balancedRows([1, 1, 1, 1], 2), [[0, 1], [2, 3]]);
});

test("frontOf prefers the front, then cover, then a non-back photo", () => {
  assert.equal(frontOf([p("b", 1, "back"), p("f", 2, "front")])?.id, "f");
  assert.equal(frontOf([p("i", 1, "inside"), p("c", 3, "cover")])?.id, "c");
  assert.equal(frontOf([p("b", 1, "back"), p("x", 2, null)])?.id, "x");
  assert.equal(frontOf([p("b", 2, "back"), p("i", 1, "inside")])?.id, "i");
});

test("lotOrder: fronts first, then the rest part by part, extras parked", () => {
  const a = [p("a1", 1, "front"), p("a2", 2, "inside"), p("a3", 3, "back")];
  const b = [p("b2", 2, "inside", "b"), p("b1", 1, "front", "b"), p("b3", 3, "back", "b")];
  const { keep, park } = lotOrder([a, b], 23);
  assert.deepEqual(keep.map((x) => x.id), ["a1", "b1", "a2", "a3", "b2", "b3"]);
  assert.equal(park.length, 0);
  const tight = lotOrder([a, b], 4);
  assert.deepEqual(tight.keep.map((x) => x.id), ["a1", "b1", "a2", "a3"]);
  assert.deepEqual(tight.park.map((x) => x.id), ["b2", "b3"]);
});

test("lot pool: postcard detection and the no-mixing rule", async () => {
  const { looksLikePostcard, mixProblem } = await import("./pool");
  assert.equal(looksLikePostcard("Vintage Linen Postcard Mobile AL"), true);
  assert.equal(looksLikePostcard("RPPC Main Street"), true);
  assert.equal(looksLikePostcard("1950s St. Louis Souvenir Brochure"), false);
  assert.equal(mixProblem([{ isPostcard: true }, { isPostcard: true }], false), null);
  assert.equal(mixProblem([{ isPostcard: false }, { isPostcard: false }], false), null);
  assert.ok(mixProblem([{ isPostcard: true }, { isPostcard: false }], false));
  assert.equal(mixProblem([{ isPostcard: true }, { isPostcard: false }], true), null);
});

test("lot pool: ready rule", async () => {
  const { lotReady } = await import("./pool");
  assert.equal(lotReady(1, 40), false);
  assert.equal(lotReady(2, 10), false);
  assert.equal(lotReady(2, 15), true);
  assert.equal(lotReady(3, 6), true);
});
