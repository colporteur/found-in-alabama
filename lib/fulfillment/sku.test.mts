// Run: npx tsx --test lib/fulfillment/sku.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { buildPickSections, classifySku } from "./sku";

test("classifySku follows the Nifty Pick List rules", () => {
  assert.deepEqual(classifySku("na294"), { type: "inventory", group: "NA", sortKey: 294, sku: "NA294" });
  assert.equal(classifySku("LT 22").sku, "LT22");
  assert.equal(classifySku("260408").type, "dated");
  assert.equal(classifySku("33 260220").group, "33");
  assert.equal(classifySku("261399").type, "named"); // month 13
  assert.equal(classifySku("2602").type, "named");
  assert.equal(classifySku("Smalls 1").group, "Smalls 1");
  assert.equal(classifySku("").group, "(no SKU)");
  assert.equal(classifySku(null).group, "(no SKU)");
});

test("buildPickSections walks dated → inventory → named in shelf order", () => {
  const skus = ["Apps", "NA62", "260101", "NA294", "33 260220", "260322", "LT222", "33 260101", "Apps", "LT225"];
  const s = buildPickSections(skus.map((sku, i) => ({ sku, i })), (x) => x.sku);
  assert.deepEqual(s.map((x) => x.type), ["dated", "inventory", "named"]);
  const flat = s.flatMap((x) => x.groups.map((g) => `${g.name}:${g.items.map((i) => i.sku).join(",")}`));
  assert.deepEqual(flat, [
    "(no prefix):260322,260101",
    "33:33 260220,33 260101",
    "LT:LT225,LT222",
    "NA:NA294,NA62",
    "Apps:Apps,Apps",
  ]);
  assert.equal(s[1].count, 4);
});
