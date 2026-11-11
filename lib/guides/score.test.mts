// Run: npx tsx --test lib/guides/score.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLinker, type LinkGuide } from "./score";

const g = (id: string, family: string, keywords: string[], extra: Partial<LinkGuide> = {}): LinkGuide => ({
  id, family, parent: null, stage: "list", priority: 2, keywords, ...extra,
});
const L = buildLinker([
  g("postcard-guide", "Postcards", ["postcard", "rppc"], { ebayCategoryIds: ["262042"] }),
  g("roadside-postcards", "Postcards", ["motel", "roadside", "gas station"], { parent: "postcard-guide", storeCategories: ["Roadside & Motels"] }),
  g("vintage-photo-guide", "Photographs", ["snapshot", "photo", "photograph"], { storeCategories: ["Photographs"] }),
  g("sewing-patterns", "Paper & Ephemera", ["sewing pattern", "simplicity", "butterick"], { storeCategories: ["Sewing Patterns"], ebayCategoryIds: ["28174"] }),
  g("costume-jewelry", "Objects & Collectibles", ["ring", "brooch", "pin"]),
  g("advertising-ink-blotters", "Paper & Ephemera", ["ink blotter", "blotter"], { storeCategories: ["Advertising Ephemera"] }),
  g("pre-purchase-lot-valuation", "Buy-side (sourcing)", ["postcard", "lot"], { stage: "buy" }),
]);

test("a phrase plus shelf and category is a confident link", () => {
  const r = L.score({ title: "Simplicity S9320 Girls Dress Sewing Pattern Size 2-5", siteCategoryId: "28174", storeCategory: "Sewing Patterns" });
  assert.equal(r.guideId, "sewing-patterns");
  assert.equal(r.confident, true);
});
test("the child guide wins over its parent, and the parent is not a rival", () => {
  const r = L.score({ title: "Best Western Acorn Inn Motel Cameron MO Chrome Postcard Roadside", siteCategoryId: "262042", storeCategory: "Roadside &amp; Motels" });
  assert.equal(r.guideId, "roadside-postcards");
  assert.equal(r.confident, true);
  assert.equal(r.altGuideId, null);
});
test("whole words only: 'spring' is not a ring", () => {
  assert.equal(L.score({ title: "Vintage Salter Brass Spring Scale Luggage Postal Weighing Tool" }).guideId, null);
});
test("a postcard is never filed under a photograph guide", () => {
  const r = L.score({ title: "Vintage 1952 Richard Nixon Family Photo Postcard", siteCategoryId: "262042" });
  assert.equal(r.guideId, "postcard-guide");
});
test("one loose word is a weak link for review, not a confident one", () => {
  const r = L.score({ title: "Paul Anka Spotlight 29 Casino Commemorative Pin" });
  assert.equal(r.guideId, "costume-jewelry");
  assert.equal(r.confident, false);
});
test("a shelf alone is only a hint", () => {
  const r = L.score({ title: "Vintage Pittsburgh Washer & Appliance Service Business Card", storeCategory: "Advertising Ephemera" });
  assert.equal(r.guideId, "advertising-ink-blotters");
  assert.equal(r.confident, false);
});
test("the guide a listing was written with counts, even past a format gate", () => {
  const r = L.score({ title: "Group on Ship Deck Ocean Liner", draftGuideIds: ["vintage-photo-guide"] });
  assert.equal(r.guideId, "vintage-photo-guide");
  assert.equal(r.confident, true);
});
test("a child with its own word in the title beats the parent the listing was written with", () => {
  const r = L.score({ title: "Flamingo Court Motel Orlando Florida Linen Postcard", siteCategoryId: "262042", draftGuideIds: ["postcard-guide"] });
  assert.equal(r.guideId, "roadside-postcards");
  assert.equal(r.confident, true);
});
test("buy-side guides never own an item; plurals match", () => {
  assert.equal(L.guideIds.has("pre-purchase-lot-valuation"), false);
  assert.equal(L.score({ title: "Lot of 40 Vintage Sewing Patterns 1970s" }).guideId, "sewing-patterns");
});
