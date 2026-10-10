// Run: npx tsx --test lib/books/fees.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BOOKS_SETTINGS as S, estimateFee, orderProfit, parseBooksSettings } from "./fees";

test("fee estimates per venue", () => {
  assert.equal(estimateFee("ebay", 10, S), 1.76);
  assert.equal(estimateFee("poshmark", 12, S), 2.95);
  assert.equal(estimateFee("poshmark", 20, S), 4);
  assert.equal(estimateFee("depop", 7.87, S), 0.71);
  assert.equal(estimateFee("unknown", 10, S), 0);
});

test("order profit uses real fees when known and flags missing costs", () => {
  const p = orderProfit({ venue: "ebay", itemsTotal: 19.74, shippingPaid: 5, actualFees: 3.41, shippingCost: null, itemCost: 2, unknownCostLines: 0 }, S);
  assert.equal(p.revenue, 24.74);
  assert.equal(p.fees, 3.41);
  assert.equal(p.feesEstimated, false);
  assert.equal(p.shippingCost, null);
  assert.equal(p.profit, 19.33);
  assert.equal(p.incomplete, true);
  const q = orderProfit({ venue: "poshmark", itemsTotal: 20, shippingPaid: null, actualFees: null, shippingCost: null, itemCost: 3, unknownCostLines: 0 }, S);
  assert.equal(q.shippingCost, 0);
  assert.equal(q.profit, 13);
  assert.equal(q.incomplete, false);
});

test("settings parse keeps defaults and clamps bad values", () => {
  const s = parseBooksSettings({ fees: { ebay: { pct: "12.9", fixed: -3 } }, buyerPaidLabel: ["depop", "bogus"] });
  assert.equal(s.fees.ebay.pct, 12.9);
  assert.equal(s.fees.ebay.fixed, 0.4);
  assert.deepEqual(s.buyerPaidLabel, ["depop"]);
  assert.equal(s.fees.poshmark.flatUnder?.fee, 2.95);
});
