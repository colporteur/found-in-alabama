// Run: npx tsx --test lib/sales/mercari-worker.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { searchWords } from "./mercari-worker.ts";

test("search words: first six words, punctuation dropped", () => {
  assert.equal(searchWords("Niagara Falls Maid of the Mist Boat Canadian Horseshoe Falls Chrome Postcard"), "Niagara Falls Maid of the Mist");
  assert.equal(searchWords("St. Mary's Church, Warren OH — 1910"), "St Mary's Church Warren OH 1910");
  assert.equal(searchWords(""), "");
});
