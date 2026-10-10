// Run: npx tsx --test lib/ebay/orders.test.mts
// Made-up order in the Fulfillment API's shape (public repo: no real buyers).
import test from "node:test";
import assert from "node:assert/strict";
import { parseEbayOrders } from "./orders";

const SAMPLE = {
  total: 1,
  orders: [
    {
      orderId: "01-23456-78901",
      creationDate: "2026-10-09T14:03:11.000Z",
      orderFulfillmentStatus: "NOT_STARTED",
      buyer: { username: "sample_buyer", buyerRegistrationAddress: { fullName: "Pat Example" } },
      pricingSummary: { total: { value: "24.74", currency: "USD" }, deliveryCost: { value: "5.00", currency: "USD" } },
      cancelStatus: { cancelState: "NONE_REQUESTED" },
      totalMarketplaceFee: { value: "3.41", currency: "USD" },
      fulfillmentStartInstructions: [
        {
          shippingStep: {
            shipTo: {
              fullName: "Pat Example",
              contactAddress: { addressLine1: "123 Main St", city: "Springfield", stateOrProvince: "IL", postalCode: "62701", countryCode: "US" },
            },
          },
        },
      ],
      lineItems: [
        { lineItemId: "10001", legacyItemId: "117400000001", title: "Postcard A", sku: "NA12", quantity: 1, lineItemCost: { value: "9.87" } },
        { lineItemId: "10002", legacyItemId: "117400000002", title: "Postcard B", quantity: 1, lineItemCost: { value: "9.87" } },
      ],
    },
    { orderId: "", lineItems: [] },
  ],
};

test("parseEbayOrders reads buyer, ship-to, totals and combined lines", () => {
  const [o, ...rest] = parseEbayOrders(SAMPLE);
  assert.equal(rest.length, 0);
  assert.equal(o.orderId, "01-23456-78901");
  assert.equal(o.buyerUsername, "sample_buyer");
  assert.equal(o.buyerName, "Pat Example");
  assert.equal(o.shipTo?.city, "Springfield");
  assert.equal(o.total, 24.74);
  assert.equal(o.shipping, 5);
  assert.equal(o.fees, 3.41);
  assert.equal(o.cancelled, false);
  assert.deepEqual(o.lines.map((l) => [l.legacyItemId, l.lineCost]), [["117400000001", 9.87], ["117400000002", 9.87]]);
});

test("cancelled orders are flagged", () => {
  const [o] = parseEbayOrders({ orders: [{ ...SAMPLE.orders[0], cancelStatus: { cancelState: "CANCELED" } }] });
  assert.equal(o.cancelled, true);
});
