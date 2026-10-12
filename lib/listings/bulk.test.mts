// Run: npx tsx --test lib/listings/bulk.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { isPlacePath, nextShelves, parentShelves, type ShelfInfo } from "./bulk";

const info = new Map<string, ShelfInfo>([
  ["pc", { id: "pc", path: "Postcards › Churches", isPlace: false }],
  ["ep", { id: "ep", path: "Ephemera › Religious", isPlace: false }],
  ["in", { id: "in", path: "Found in Other States › Indiana", isPlace: true }],
  ["al", { id: "al", path: "Alabama › Birmingham", isPlace: true }],
  ["oh", { id: "oh", path: "Found in Other States › Ohio", isPlace: true }],
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

test("a new place shelf replaces the old place shelf, not the item shelf", () => {
  assert.deepEqual(nextShelves(["pc", "in"], "oh", true, info), ["pc", "oh"]);
  assert.deepEqual(nextShelves(["in", "pc"], "oh", true, info), ["oh", "pc"]);
  assert.deepEqual(nextShelves(["pc"], "oh", true, info), ["pc", "oh"]);
  assert.deepEqual(nextShelves(["pc", "ep"], "oh", true, info), ["pc", "oh"]);
});

test("parentShelves lists parents with their assignable subcategories", () => {
  const cats = [
    { id: "P", parentId: null, name: "Postcards", isOther: false },
    { id: "P1", parentId: "P", name: "Churches", isOther: false },
    { id: "P2", parentId: "P", name: "Linen", isOther: false },
    { id: "B", parentId: null, name: "Books &amp; Magazines", isOther: false },
    { id: "L", parentId: "B", name: "LPs", isOther: false },
    { id: "L1", parentId: "L", name: "Jazz", isOther: false },
    { id: "X", parentId: null, name: "Other", isOther: true },
    { id: "S", parentId: null, name: "Single", isOther: false },
  ];
  const p = parentShelves(cats, new Set(["P1", "P2", "L1", "S"]));
  assert.deepEqual(p.map((x) => [x.path, x.leafIds]), [
    ["Books & Magazines", ["L1"]],
    ["Books & Magazines › LPs", ["L1"]],
    ["Postcards", ["P1", "P2"]],
  ]);
});
