// Run: npx tsx --test lib/tes/ship-notice.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { brandFor, shipNoticeContent } from "./ship-notice";

const base = { orderId: "8a4c0c73-00ab-4a63-9cf2-ae6d53bc0b35", name: "Corey White", items: ["1935-36 Courtship Letters Lot"], carrier: null };

test("the order's store sends it", () => {
  assert.match(brandFor("tes").from, /Ephemeral State/);
  assert.equal(brandFor("tes").name, "The Ephemeral State");
  assert.equal(brandFor("fia").name, "Found in Alabama");
});

test("tracking email: number and link, no photo", () => {
  const c = shipNoticeContent({ ...base, brand: brandFor("tes"), tracking: "9400111899223197428490", carrier: "USPS", photoUrl: null });
  assert.equal(c.subject, "Your order from The Ephemeral State has shipped");
  assert.match(c.text, /Hi Corey,/);
  assert.match(c.text, /Tracking number: 9400111899223197428490/);
  assert.match(c.html, /tools\.usps\.com/);
  assert.match(c.text, /Order 8A4C0C73/);
  assert.doesNotMatch(c.text, /stamp/);
});

test("stamped email: no tracking, the photo, and no delivery-days promise", () => {
  const c = shipNoticeContent({ ...base, brand: brandFor("fia"), tracking: null, photoUrl: "https://photos.example/orders/x/mailpiece.jpg" });
  assert.match(c.text, /First-Class Mail with a stamp, so it doesn't have a tracking number/);
  assert.match(c.html, /<img src="https:\/\/photos\.example\/orders\/x\/mailpiece\.jpg"/);
  assert.doesNotMatch(c.text, /\d\s*[–-]\s*\d\s*days/i);
  assert.match(c.text, /Found in Alabama/);
});

test("titles are escaped in HTML", () => {
  const c = shipNoticeContent({ ...base, items: ["<b>Card</b> & Co"], brand: brandFor("tes"), tracking: null, photoUrl: null });
  assert.match(c.html, /&lt;b&gt;Card&lt;\/b&gt; &amp; Co/);
});
