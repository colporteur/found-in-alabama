// Run: npx tsx --test lib/shop/invoice-pitch.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { choosePitch, makeCounter, pickSite, stockNumber, type PitchCat } from "./invoice-pitch";
import { cleanCode, newCode } from "./coupons";
import { couponFits } from "./coupon-fit";

const cat = (id: string, parent: string | null, name: string, tes = false, extra: Partial<PitchCat> = {}): PitchCat => ({
  categoryId: id, parentCategoryId: parent, name, isEphemeralState: tes, invoiceLabel: null, invoiceCountLevel: "self", ...extra,
});
// Postcards (TES) > Alabama postcards ; Books (FIA) > UA books
const cats = [
  cat("pc", null, "Postcards", true, { invoiceLabel: "postcards" }),
  cat("pcal", "pc", "Alabama"),
  cat("bk", null, "Books"),
  cat("ua", "bk", "University of Alabama", false, { invoiceLabel: "University of Alabama items" }),
  cat("rare", "bk", "Rare &amp; Odd"),
];
const tesSet = new Set(["pc", "pcal"]);
const items = [
  ...Array.from({ length: 4329 }, () => ({ cats: ["pc"] })),
  ...Array.from({ length: 10 }, () => ({ cats: ["pcal", "ua"] })),
  ...Array.from({ length: 63 }, () => ({ cats: ["ua"] })),
  ...Array.from({ length: 3 }, () => ({ cats: ["rare"] })),
];

test("stockNumber rounds down and says 'over'", () => {
  assert.equal(stockNumber(73), "73");
  assert.equal(stockNumber(140), "140");
  assert.equal(stockNumber(147), "over 140");
  assert.equal(stockNumber(4329), "over 4,300");
  assert.equal(stockNumber(12500), "over 12,000");
});

test("pickSite: website orders keep their site; marketplace goes by the priciest item's categories", () => {
  assert.equal(pickSite("tes", [{ price: 5, cats: ["ua"] }], tesSet).site, "tes");
  assert.deepEqual(pickSite("ebay", [{ price: 5, cats: ["ua"] }, { price: 9, cats: ["pcal"] }], tesSet), { site: "tes", cat: "pcal" });
  assert.deepEqual(pickSite("mercari", [{ price: 20, cats: ["ua"] }, { price: 9, cats: ["pcal"] }], tesSet), { site: "fia", cat: "ua" });
  assert.deepEqual(pickSite("ebay", [{ price: 5, cats: [] }], tesSet), { site: "fia", cat: null });
});

test("counter: subtree counts, items once, TES only counts TES items", () => {
  const fia = makeCounter(cats, items, "fia", tesSet);
  assert.equal(fia.total, 4405);
  assert.equal(fia.of("pc"), 4339);
  assert.equal(fia.of("ua"), 73);
  assert.equal(fia.of("bk"), 76);
  const tes = makeCounter(cats, items, "tes", tesSet);
  assert.equal(tes.total, 4339);
  assert.equal(tes.of("ua"), 10);
});

test("choosePitch: label, climb to parent under the minimum, then the store", () => {
  const base = { cats, tesSet, slugOf: (_s: "fia" | "tes", id: string) => (id === "pc" ? "postcards" : null), code: "TES7K3QX9" };
  const t = choosePitch({ ...base, site: "tes", startCat: "pcal", counter: makeCounter(cats, items, "tes", tesSet), min: 25 });
  assert.equal(t.categoryId, "pc");
  assert.equal(t.text, "theephemeralstate.com has over 4,300 postcards in stock today");
  assert.equal(t.url, "https://theephemeralstate.com/shop/postcards?code=TES7K3QX9");
  const fia = makeCounter(cats, items, "fia", tesSet);
  const u = choosePitch({ ...base, site: "fia", startCat: "ua", counter: fia, min: 25, code: null });
  assert.equal(u.text, "foundinalabama.com has 73 University of Alabama items in stock today");
  const r = choosePitch({ ...base, site: "fia", startCat: "rare", counter: fia, min: 25, code: null });
  assert.equal(r.text, "foundinalabama.com has 76 items in Books in stock today");
  const s = choosePitch({ ...base, site: "fia", startCat: "rare", counter: fia, min: 1000, code: null });
  assert.equal(s.categoryId, null);
  assert.equal(s.text, "foundinalabama.com has over 4,400 items in stock today");
  assert.equal(s.url, "https://foundinalabama.com/");
  // "parent" starts one level up
  const cats2 = cats.map((c) => (c.categoryId === "ua" ? { ...c, invoiceCountLevel: "parent" as const } : c));
  const p = choosePitch({ ...base, cats: cats2, site: "fia", startCat: "ua", counter: fia, min: 25, code: null });
  assert.equal(p.categoryId, "bk");
  // TES never climbs out of TES categories
  const tesNo = choosePitch({ ...base, site: "tes", startCat: "pcal", counter: makeCounter(cats, items, "tes", tesSet), min: 100000 });
  assert.equal(tesNo.categoryId, null);
});

test("codes: TES prefix, clean scanned codes", () => {
  assert.match(newCode(6, "TES"), /^TES[A-Z0-9]{6}$/);
  assert.equal(cleanCode(" tes7k3qx9 "), "TES7K3QX9");
  assert.equal(cleanCode("HELLO123"), null);
  assert.equal(cleanCode(null), null);
});

test("fit still works with a taller coupon", () => {
  assert.equal(couponFits(300, 150, 547), true);
  assert.equal(couponFits(420, 150, 547), false);
});

test("catch-all categories are never named", () => {
  const c2 = [...cats, cat("oth", null, "Other", false, { catchAll: true })];
  const its = [...items, ...Array.from({ length: 50 }, () => ({ cats: ["oth"] }))];
  const p = choosePitch({ site: "fia", startCat: "oth", cats: c2, counter: makeCounter(c2, its, "fia", tesSet), tesSet, min: 25, slugOf: () => null });
  assert.equal(p.categoryId, null);
});
