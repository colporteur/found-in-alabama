// Run: npx tsx --test lib/fulfillment/buyers.test.mts
// Samples are made up (public repo) but follow the real emails' wording.
import test from "node:test";
import assert from "node:assert/strict";
import { parseEmailBuyer } from "./buyers";

test("Poshmark buyer from the subject", () => {
  const b = parseEmailBuyer("poshmark", '"Glass Dinner Bell" just sold to @sample_buyer12 on Poshmark!', null);
  assert.equal(b.username, "sample_buyer12");
});

test("Depop buyer, name and ship-to from subject and body", () => {
  const html = `<html><style>.x{}</style><p>Order details</p><p>Vintage Card… $7.87</p>
    <p>Ship to</p><p>Pat Example</p><p>123 Main St</p><p>Springfield IL US 62701</p>
    <p>Buyer</p><p>samplehandle</p><p>Payment details</p></html>`;
  const b = parseEmailBuyer("depop", "Your USPS shipping label and sale confirmation for @samplehandle.", html);
  assert.equal(b.username, "samplehandle");
  assert.equal(b.name, "Pat Example");
  assert.match(b.shipToText ?? "", /^Pat Example, 123 Main St Springfield IL US 62701$/);
});

test("venues without buyer data return nulls", () => {
  assert.deepEqual(parseEmailBuyer("mercari", "You've made a sale: Thing", null), { username: null, name: null, shipToText: null });
});
