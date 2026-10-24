// Run: npx tsx --test lib/shipping/mail.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { mailFacts, parseSize, pieceCount } from "./mail.ts";
import { itemShipClass, quoteShipping } from "../tes/shipping.ts";
import { DEFAULT_FIA_SHIP_SETTINGS, quoteFiaShipping } from "../fia/shipping.ts";

const PHOTOS = "Collectibles:Photographic Images:Photographs";

test("parseSize and pieceCount", () => {
  assert.deepEqual(parseSize("8.6x2.4in"), [8.6, 2.4]);
  assert.deepEqual(parseSize('5" x 7"'), [7, 5]);
  assert.equal(pieceCount("Lot of 12 Vintage Photos"), 12);
  assert.equal(pieceCount("2 Vintage 1940s Easter Snapshot Photos Little Girl"), 2);
  assert.equal(pieceCount("1990 Score Frank Thomas Rookie Card #663"), 1);
});

test("measured small photo: stamped flat and Standard Envelope fit", () => {
  const f = mailFacts({ title: "1960s ROTC Couple Color Photo", categoryId: "262421", categoryName: PHOTOS, price: 7.87, kind: "photograph", measured: "5.5x3.5in" });
  assert.equal(f.stampOk, true);
  assert.equal(f.seFit, true);
});

test("8x10 photo: flat yes, envelope no", () => {
  const f = mailFacts({ title: "Vintage 8x10 Press Photo Huntsville Alabama", categoryId: "262421", categoryName: PHOTOS, price: 12.87 });
  assert.equal(f.size?.source, "title");
  assert.equal(f.stampOk, true);
  assert.equal(f.seFit, false);
});

test("unknown size, too big, too pricey, rigid, too many", () => {
  assert.equal(mailFacts({ title: "Vintage Snapshot Girl with Dog", categoryId: "262421", categoryName: PHOTOS, price: 6.87 }).stampOk, false);
  assert.equal(mailFacts({ title: "Large photo", categoryId: "262421", categoryName: PHOTOS, price: 9.87, measured: "16x20in" }).stampOk, false);
  assert.equal(mailFacts({ title: "Cabinet Card Photo Woman", categoryId: "262421", categoryName: PHOTOS, price: 24.87 }).stampOk, false);
  assert.equal(mailFacts({ title: "Framed Cabinet Card Photo", categoryId: "262421", categoryName: PHOTOS, price: 9.87 }).stampOk, false);
  assert.equal(mailFacts({ title: "Lot of 25 Vintage Snapshot Photos 3x5", categoryId: "262421", categoryName: PHOTOS, price: 19.87 }).stampOk, false);
});

test("formats: cabinet card, postcard, trading card", () => {
  const cab = mailFacts({ title: "1889 Cabinet Card Photo Marie in Graduation Dress", categoryId: "262421", categoryName: PHOTOS, price: 9.87 });
  assert.equal(cab.stampOk, true);
  assert.equal(cab.seFit, true); // 6½ × 4¼ fits inside 6⅛ × 11½
  const pc = mailFacts({ title: "Atlantic City NJ Linen Postcard 1957", categoryId: "262042", categoryName: "Collectibles:Postcards & Supplies:Postcards:Topographical Postcards", price: 5.87 });
  assert.equal(pc.seFit, true);
  const lot = mailFacts({ title: "Lot of 5 Antique Postcards", categoryId: "262042", categoryName: "Collectibles:Postcards & Supplies:Postcards:Topographical Postcards", price: 9.87 });
  assert.equal(lot.seFit, false); // eBay: at most 3 postcards per envelope
  assert.equal(lot.stampOk, true);
  const card = mailFacts({ title: "1987 Fleer Jose Canseco #389", categoryId: "261328", categoryName: "Sports Mem, Cards & Fan Shop:Sports Trading Cards:Trading Card Singles", price: 5.87 });
  assert.equal(card.seFit, true);
  assert.equal(mailFacts({ title: "1952 Topps Mantle PSA 3", categoryId: "261328", categoryName: "Sports Mem, Cards & Fan Shop:Sports Trading Cards:Trading Card Singles", price: 15 }).seFit, false);
});

test("TES class: envelope listings pay paper even on a bulky shelf; flat beats bulky, not paper", () => {
  assert.equal(itemShipClass("paper", "bulky", { services: ["US_eBayStandardEnvelope"] }), "paper");
  assert.equal(itemShipClass("paper", "bulky", { services: ["USPSGroundAdvantage"], stampOk: true }), "flat");
  assert.equal(itemShipClass("paper", "paper", { services: [], stampOk: true }), "paper");
  assert.equal(itemShipClass("bulky", null, { services: [], stampOk: false }), "bulky");
  assert.equal(quoteShipping([{ shipClass: "flat", quantity: 2, price: 5 }]).shipping, 2.74);
});

test("FIA: stamped envelope / flat / parcel", () => {
  const s = DEFAULT_FIA_SHIP_SETTINGS;
  const base = { weightOz: 4, shipClass: "paper" as const, mediaEligible: false };
  const env = quoteFiaShipping([{ ...base, mail: "envelope", quantity: 1, price: 7.87 }], s);
  assert.ok(env.ok && env.service === "envelope" && env.shipping === 1.99);
  const flat = quoteFiaShipping([{ ...base, mail: "envelope", quantity: 1, price: 7.87 }, { ...base, mail: "flat", quantity: 1, price: 9.87 }], s);
  assert.ok(flat.ok && flat.service === "flat" && flat.shipping === 2.74);
  const fourEnv = quoteFiaShipping([{ ...base, mail: "envelope", quantity: 4, price: 5 }], s);
  assert.ok(fourEnv.ok && fourEnv.service === "flat" && fourEnv.shipping === 3.24);
  const mixed = quoteFiaShipping([{ ...base, mail: "flat", quantity: 1, price: 9 }, { ...base, mail: null, quantity: 1, price: 9 }], s);
  assert.ok(mixed.ok && mixed.service === "ground");
  const pricey = quoteFiaShipping([{ ...base, mail: "flat", quantity: 3, price: 19 }], s);
  assert.ok(pricey.ok && pricey.service === "ground"); // over the $50 untracked-mail cap
});
