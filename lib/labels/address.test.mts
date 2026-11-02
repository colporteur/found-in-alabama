// Run: npx tsx --test lib/labels/address.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { addressLines } from "./address";

test("Stripe address (website order)", () => {
  assert.deepEqual(
    addressLines("Corey White", { city: "Abilene", line1: "3174 South 20th Street", line2: null, state: "TX", country: "US", postal_code: "79605" }),
    ["COREY WHITE", "3174 SOUTH 20TH STREET", "ABILENE, TX 79605"]
  );
});

test("eBay address with name inside, apartment line, foreign country", () => {
  assert.deepEqual(
    addressLines(null, { name: "Ann Lee", line1: "1 Main St", line2: "Apt 4", city: "Toronto", state: "ON", postalCode: "M5V 2T6", country: "CA" }),
    ["ANN LEE", "1 MAIN ST", "APT 4", "TORONTO, ON M5V 2T6", "CA"]
  );
});

test("a plain text block from a buyer email keeps its lines", () => {
  assert.deepEqual(addressLines("Jo Ray", { text: "Jo Ray\n12 Elm Rd\nAustin, TX 78701" }), ["Jo Ray", "12 Elm Rd", "Austin, TX 78701"]);
  assert.deepEqual(addressLines("Jo Ray", { text: "12 Elm Rd\nAustin, TX 78701" }), ["Jo Ray", "12 Elm Rd", "Austin, TX 78701"]);
});

test("nothing on file", () => {
  assert.deepEqual(addressLines(null, null), []);
});
