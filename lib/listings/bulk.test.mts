// Run: npx tsx --test lib/listings/bulk.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { isPlacePath, nextShelves, type ShelfInfo } from "./bulk";

const info = new Map<string, ShelfInfo>([
  ["pc", { id: "pc", path: "Postcards › Churches", isPlace: false }],
  ["ep", { id: "ep", path: "Ephemera › Religious", isPlace: false }],
  ["in", { id: "in", path: "Found in Other States › Indiana", isPlace: true }],
  ["al", { id: "al", path: "Alabama › Birmingham", isPlace: true }],
]);

test("place shelves", () => {
  assert.equal(isPlacePath("Found in Other States › Ohio", false), true);
  assert.equal(isPlacePath("Postcards › Churches", false), false);
  assert.equal(isPlacePath("Birmingham", true), true);
});

test("keep the place shelf, replace the other", () => {
  assert.deepEqual(nextShelves(["ep", "in"], "pc", true, info), ["pc", "in"]);
  assert.deepEqual(nextShelves(["in", "ep"], "pc", true, info), ["pc", "in"]);
  assert.deepEqual(nextShelves(["al"], "pc", true, info), ["pc", "al"]);
  assert.deepEqual(nextShelves(["pc", "in"], "pc", true, info), ["pc", "in"]);
  // No place shelf: first is replaced, second kept.
  assert.deepEqual(nextShelves(["ep", "pc"], "pc", true, info), ["ep", "pc"]);
  assert.deepEqual(nextShelves([], "pc", true, info), ["pc"]);
});

test("without keep: replace the first shelf", () => {
  assert.deepEqual(nextShelves(["in", "ep"], "pc", false, info), ["pc", "ep"]);
  assert.deepEqual(nextShelves(["ep"], "pc", false, info), ["pc"]);
});
