// npx tsx scripts/fia-shipping.test.mts
// Phase FIA-SHOP-1 — weight-based shipping quote for foundinalabama.com.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FIA_SHIP_SETTINGS as D,
  directSaleCheck,
  isMediaService,
  normalizeFiaShipSettings,
  quoteFiaShipping,
  tableToText,
  textToTable,
  type FiaQuoteLine,
} from "../lib/fia/shipping";

const book = (oz: number | null, price = 20): FiaQuoteLine => ({
  weightOz: oz, shipClass: "media", mediaEligible: true, quantity: 1, price,
});
const thing = (oz: number | null, price = 20): FiaQuoteLine => ({
  weightOz: oz, shipClass: "bulky", mediaEligible: false, quantity: 1, price,
});

test("single 14 oz book ships Media Mail at the 1 lb rate", () => {
  const q = quoteFiaShipping([book(14)], D);
  assert.ok(q.ok);
  assert.equal(q.service, "media");
  assert.equal(q.shipping, 4.39);
  assert.equal(q.weightOz, 14);
});

test("a non-media item in the cart moves everything to Ground Advantage", () => {
  const q = quoteFiaShipping([book(14), thing(6)], D);
  assert.ok(q.ok);
  assert.equal(q.service, "ground");
  // 14 + 6 − 2 oz packaging credit = 18 oz → 32 oz step
  assert.equal(q.weightOz, 18);
  assert.equal(q.shipping, 9.95);
});

test("combined weight never drops below the heaviest unit", () => {
  const q = quoteFiaShipping([book(1), book(1), book(1)], { ...D, combineCreditOz: 5 });
  assert.ok(q.ok);
  assert.equal(q.weightOz, 1);
});

test("quantity multiplies the unit weight", () => {
  const q = quoteFiaShipping([{ ...book(10), quantity: 3 }], D);
  assert.ok(q.ok);
  assert.equal(q.weightOz, 26); // 30 − 2×2
  assert.equal(q.shipping, 5.13);
});

test("missing weight uses the class fallback and is counted as estimated", () => {
  const q = quoteFiaShipping([book(null)], D);
  assert.ok(q.ok);
  assert.equal(q.weightOz, D.fallbackOz.media);
  assert.equal(q.estimatedUnits, 1);
});

test("handling is added; free threshold zeroes shipping and reports the gap", () => {
  const s = { ...D, handling: 1, freeAt: 50 };
  const under = quoteFiaShipping([book(14, 30)], s);
  assert.ok(under.ok);
  assert.equal(under.shipping, 5.39);
  assert.equal(under.remainingForFree, 20);
  const over = quoteFiaShipping([book(14, 60)], s);
  assert.ok(over.ok);
  assert.equal(over.free, true);
  assert.equal(over.shipping, 0);
});

test("a cart heavier than the table is refused", () => {
  const q = quoteFiaShipping([{ ...thing(300), quantity: 2 }], D);
  assert.equal(q.ok, false);
});

test("direct-sale caps: weight and longest side", () => {
  assert.deepEqual(directSaleCheck(thing(400), D), { ok: false, reason: "too_heavy" });
  assert.deepEqual(directSaleCheck({ ...thing(40), lengthIn: 30 }, D), { ok: false, reason: "too_big" });
  assert.deepEqual(directSaleCheck(thing(null), D), { ok: true });
});

test("Media Mail detection from eBay service codes", () => {
  assert.equal(isMediaService(["USPSMedia"]), true);
  assert.equal(isMediaService(["USPSGroundAdvantage", "USPSPriority"]), false);
  assert.equal(isMediaService(null), false);
});

test("settings normalize over defaults and tables round-trip as text", () => {
  const n = normalizeFiaShipSettings({ handling: "1.5", groundTable: "nope", fallbackOz: { paper: 4 } });
  assert.equal(n.handling, 1.5);
  assert.deepEqual(n.groundTable, D.groundTable);
  assert.equal(n.fallbackOz.paper, 4);
  assert.equal(n.fallbackOz.media, D.fallbackOz.media);
  assert.deepEqual(textToTable(tableToText(D.mediaTable)), D.mediaTable);
  assert.deepEqual(textToTable("# comment\n32, $9.95\n16 4.39\nbad"), [
    { maxOz: 16, price: 4.39 },
    { maxOz: 32, price: 9.95 },
  ]);
});
