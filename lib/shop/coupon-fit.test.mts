// Run: npx tsx --test lib/shop/coupon-fit.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { planCouponLayout } from "./coupon-fit";

const label = 547; // 5.7in × 96
const base = { footerPx: 25, fullPx: 120, stockPx: 18, compactPx: 62, labelPx: label, alabama: false };

test("planCouponLayout: roomy label keeps everything", () => {
  assert.deepEqual(planCouponLayout({ ...base, bodyPx: 300 }), { fit: "full", footer: true });
});

test("planCouponLayout: stock line goes first", () => {
  assert.deepEqual(planCouponLayout({ ...base, bodyPx: 410 }), { fit: "short", footer: true });
});

test("planCouponLayout: Alabama drops the footer before shrinking the box", () => {
  // 430 + 120 + 12 > 547, but 405 + 120 + 12 fits
  assert.deepEqual(planCouponLayout({ ...base, bodyPx: 430, alabama: true }), { fit: "short", footer: false });
  // non-Alabama at the same height keeps the footer and goes compact
  assert.deepEqual(planCouponLayout({ ...base, bodyPx: 430 }), { fit: "compact", footer: true });
});

test("planCouponLayout: compact box when the big one won't fit even without the footer", () => {
  assert.deepEqual(planCouponLayout({ ...base, bodyPx: 470, alabama: true }), { fit: "compact", footer: false });
});

test("planCouponLayout: nothing fits — no code, footer back", () => {
  assert.deepEqual(planCouponLayout({ ...base, bodyPx: 540, alabama: true }), { fit: "none", footer: true });
  assert.deepEqual(planCouponLayout({ ...base, bodyPx: 500 }), { fit: "none", footer: true });
});

test("planCouponLayout: no stock line means full, never short", () => {
  assert.deepEqual(planCouponLayout({ ...base, stockPx: 0, bodyPx: 410 }), { fit: "full", footer: true });
});
