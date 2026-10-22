// Run: npx tsx --test lib/listings/fixes.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { diffSnapshot } from "./fixes";

const before = {
  fields: { title: "Linen Postcard 1925", description: "Old", price: "4.87", item_specifics: { Era: "Chrome" }, bin_sku: "LT1", quantity: 1 },
  photos: [
    { id: "a", position: 1, rotation: 0 },
    { id: "b", position: 2, rotation: 0 },
    { id: "c", position: 3, rotation: 0 },
  ],
};

test("diff: only changed fields, with before and after", () => {
  const now = { ...before.fields, title: "Linen Postcard 1952", price: 4.87, item_specifics: { Era: "Linen" } };
  const d = diffSnapshot(before, now, before.photos);
  assert.deepEqual(d.map((c) => c.field), ["Title", "Item specifics"]);
  assert.equal(d[0].before, "Linen Postcard 1925");
  assert.equal(d[0].after, "Linen Postcard 1952");
  assert.equal(d[1].after, "Era: Linen");
});

test("diff: photos reordered, turned, removed", () => {
  const now = [
    { id: "c", position: 1, rotation: 90 },
    { id: "a", position: 2, rotation: 0 },
  ];
  const d = diffSnapshot(before, before.fields, now);
  assert.equal(d.length, 1);
  assert.equal(d[0].field, "Photos");
  assert.equal(d[0].after, "reordered, 1 turned, 1 removed");
});

test("diff: nothing changed", () => {
  assert.deepEqual(diffSnapshot(before, { ...before.fields, price: 4.87 }, before.photos), []);
});
