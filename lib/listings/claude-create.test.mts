// Run: npx tsx --test lib/listings/claude-create.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { createExtras } from "./claude-create";
import { approvalGaps } from "./review";

test("createExtras keeps where the item and its photos are, and checks numbers", () => {
  const x = createExtras({
    title: "Pvt Willie Durham 184th Infantry Leyte KIA Funeral Photos Purple Heart Case Pins",
    source_note: "  Oxford AL estate sale, Oct 2026 ",
    photo_note: "Batch 02: 10312026–10312026_013, case closed first",
    weight_oz: "14",
    quantity: 0,
    bin: "",
  });
  assert.deepEqual(x, {
    bin: null,
    sourceNote: "Oxford AL estate sale, Oct 2026",
    photoNote: "Batch 02: 10312026–10312026_013, case closed first",
    weightOz: 14,
    quantity: null,
  });
  assert.equal(createExtras({ weight_oz: -3, quantity: 2.6 }).weightOz, null);
  assert.equal(createExtras({ quantity: 2.6 }).quantity, 3);
});

test("a draft with no photos can't be approved; one without a photo count is judged as before", () => {
  const full = { title: "A good long title here", description: "x".repeat(50), price: 9.87, condition: "Used" };
  assert.deepEqual(approvalGaps({ ...full, photos: 0 }), ["photos"]);
  assert.deepEqual(approvalGaps({ ...full, photos: 3 }), []);
  assert.deepEqual(approvalGaps(full), []);
});
