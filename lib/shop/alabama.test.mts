// Run: npx tsx --test lib/shop/alabama.test.mts
// Made-up addresses only (the repo is public).
import test from "node:test";
import assert from "node:assert/strict";
import { isAlabamaAddress } from "./alabama";
import { planPitch } from "./invoice-pitch";

test("isAlabamaAddress: label lines", () => {
  assert.equal(isAlabamaAddress(["JANE DOE", "12 MAIN ST", "HUNTSVILLE, AL 35801"]), true);
  assert.equal(isAlabamaAddress(["JANE DOE", "12 MAIN ST", "MOBILE, AL 36602-1234"]), true);
  assert.equal(isAlabamaAddress(["JANE DOE", "12 MAIN ST", "LINEVILLE, ALABAMA 36266"]), true);
  assert.equal(isAlabamaAddress(["JANE DOE", "12 MAIN ST", "ATLANTA, GA 30301"]), false);
  assert.equal(isAlabamaAddress(["AL SMITH", "12 MAIN ST", "ATLANTA, GA 30301"]), false);
  assert.equal(isAlabamaAddress(["JANE DOE", "45 ALA MOANA BLVD", "HONOLULU, HI 96814"]), false);
  assert.equal(isAlabamaAddress(["JANE DOE", "12 MAIN ST", "DOTHAN 36301"]), true);
  assert.equal(isAlabamaAddress(["JANE DOE", "12 MAIN ST", "BIRMINGHAM, AL"]), true);
  assert.equal(isAlabamaAddress(["JANE DOE"]), false);
  assert.equal(isAlabamaAddress(null), false);
});

test("isAlabamaAddress: flattened Depop ship-to and email text", () => {
  assert.equal(isAlabamaAddress("Jane Doe, 12 Main St Tuscaloosa AL 35401 United States"), true);
  assert.equal(isAlabamaAddress("Jane Doe, 12 Main St Nashville TN 37201"), false);
  assert.equal(isAlabamaAddress(["Jane Doe", "12 Main St", "Auburn, Ala. 36830"]), true);
});

test("planPitch: Alabama buyers default to FIA; a pick still wins", () => {
  const tesSet = new Set(["pc"]);
  const lines = [{ price: 9, cats: ["pc"] }];
  assert.deepEqual(planPitch("ebay", lines, null, tesSet), { site: "tes", cat: "pc", exact: false });
  assert.deepEqual(planPitch("ebay", lines, null, tesSet, true), { site: "fia", cat: "pc", exact: false });
  assert.deepEqual(planPitch("tes", lines, null, tesSet, true), { site: "fia", cat: "pc", exact: false });
  assert.deepEqual(planPitch("ebay", lines, "pc", tesSet, true), { site: "tes", cat: "pc", exact: true });
});
