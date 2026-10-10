// Run: npx tsx --test lib/listings/weight.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { lbOz, parseSize, planWeight } from "./weight";

const base = { givenOz: null, kind: null, title: null, identification: null, sizeInches: null, source: "scanroom" };

test("a given weight always wins", () => {
  assert.deepEqual(planWeight({ ...base, givenOz: 32, kind: "postcard" }).oz, 32);
  assert.equal(planWeight({ ...base, givenOz: 32 }).source, "given");
});

test("postcards are 1 oz envelope; booklets 1 lb media", () => {
  assert.deepEqual(planWeight({ ...base, kind: "postcard" }), { oz: 1, source: "assumed", reason: "postcard", profile: "envelope" });
  const b = planWeight({ ...base, kind: "ephemera", title: "Vtg Souvenir Program 1952 Talladega" });
  assert.equal(b.oz, 16);
  assert.equal(b.profile, "media");
  assert.equal(planWeight({ ...base, kind: "magazine" }).oz, 16);
});

test("Scanroom paper rounds up to 4 / 8 / 12 oz by size", () => {
  assert.equal(planWeight({ ...base, kind: "ephemera", sizeInches: "8.6x2.4in" }).oz, 4);
  assert.equal(planWeight({ ...base, kind: "document", sizeInches: "8.5x11in" }).oz, 8);
  assert.equal(planWeight({ ...base, kind: "photograph", sizeInches: "11x14+in" }).oz, 12);
  assert.equal(planWeight({ ...base, kind: "ephemera" }).oz, 12);
});

test("objects get no guess", () => {
  const p = planWeight({ ...base, kind: "other", source: "photoxfer" });
  assert.equal(p.oz, null);
  assert.equal(p.source, "none");
});

test("helpers", () => {
  assert.deepEqual(parseSize("2.4x8.6in"), [8.6, 2.4]);
  assert.equal(parseSize("big"), null);
  assert.deepEqual(lbOz(20), { lb: 1, oz: 4 });
  assert.deepEqual(lbOz(12), { lb: 0, oz: 12 });
  assert.deepEqual(lbOz(16), { lb: 1, oz: 0 });
});
