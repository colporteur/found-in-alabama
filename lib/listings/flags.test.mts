// Run: npx tsx --test lib/listings/flags.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { carriedFlags } from "./flags";

test("a revision keeps Claude's flags and drops the ones FIA works out again", () => {
  assert.deepEqual(
    carriedFlags([
      "No photo of the back",
      "No weight: not paper, so nothing was assumed — weigh it (Nifty would keep its template's weight).",
      "eBay requires: Brand — still empty",
      "Dropped item specifics that aren't fields in this category: Era",
      "No eBay category from the store's list — pick one before approving",
      "Height is from references, not measured",
      "Lot: Claude combined 4 drafts into this one — check the pieces, the cover and the price.",
      "No photo of the back",
      "  ",
    ]),
    [
      "No photo of the back",
      "Height is from references, not measured",
      "Lot: Claude combined 4 drafts into this one — check the pieces, the cover and the price.",
    ]
  );
  assert.deepEqual(carriedFlags(null), []);
  assert.deepEqual(carriedFlags("x"), []);
});
