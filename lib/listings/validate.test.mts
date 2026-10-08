// Run: npx tsx --test lib/listings/validate.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { parseIntakeRequest, roleFromName, MAX_PHOTOS } from "./validate";

const sha = (c: string) => c.repeat(64);
const photo = (c: string, extra: Record<string, unknown> = {}) => ({
  name: `${c}.jpg`,
  sha256: sha(c),
  bytes: 1000,
  contentType: "image/jpeg",
  ...extra,
});

test("a minimal PC send parses with defaults", () => {
  const r = parseIntakeRequest({ source: "scans", sourceRef: "C:/x/y", photos: [photo("a"), photo("b", { role: "back" })] });
  assert.ok(r.ok);
  assert.equal(r.value.uploadMode, "presigned");
  assert.equal(r.value.quantity, 1);
  assert.equal(r.value.replace, false);
  assert.deepEqual(r.value.photos.map((p) => p.role), [null, "back"]);
});

test("rejects bad sources, missing photos, duplicates and odd types", () => {
  assert.equal(parseIntakeRequest({ source: "ebay", photos: [photo("a")] }).ok, false);
  assert.equal(parseIntakeRequest({ source: "manual", photos: [] }).ok, false);
  assert.equal(parseIntakeRequest({ source: "manual", photos: [photo("a"), photo("a")] }).ok, false);
  assert.equal(parseIntakeRequest({ source: "manual", photos: [photo("a", { contentType: "application/pdf" })] }).ok, false);
  assert.equal(parseIntakeRequest({ source: "manual", photos: [photo("a", { sha256: "xyz" })] }).ok, false);
  const many = Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => photo("a", { sha256: i.toString(16).padStart(64, "0") }));
  assert.equal(parseIntakeRequest({ source: "manual", photos: many }).ok, false);
});

test("unknown roles are dropped, numbers range-checked", () => {
  const r = parseIntakeRequest({ source: "manual", uploadMode: "proxy", quantity: "3", weightOz: 12.5, photos: [photo("a", { role: "sideways" })] });
  assert.ok(r.ok);
  assert.equal(r.value.photos[0].role, null);
  assert.equal(r.value.quantity, 3);
  assert.equal(r.value.weightOz, 12.5);
  assert.equal(r.value.uploadMode, "proxy");
  assert.equal(parseIntakeRequest({ source: "manual", quantity: 0, photos: [photo("a")] }).ok, false);
});

test("roles from Scanroom file names", () => {
  assert.equal(roleFromName("00-cover.jpg"), "cover");
  assert.equal(roleFromName("01-front.jpg"), "front");
  assert.equal(roleFromName("02-inside-01.jpg"), "inside");
  assert.equal(roleFromName("05-back.jpg"), "back");
  assert.equal(roleFromName("Scan_0004.jpg"), null);
  assert.equal(roleFromName("background.jpg"), null);
});

import { parseSpecifics, formatSpecifics } from "./drafts";
test("item specifics round-trip through the text box format", () => {
  const spec = parseSpecifics("Brand: Curt Teich\nEra: Linen (1930-1945)\nTheme: Cowboys | Western\nbad line\nEmpty:");
  assert.deepEqual(spec, { Brand: "Curt Teich", Era: "Linen (1930-1945)", Theme: ["Cowboys", "Western"] });
  assert.equal(formatSpecifics(spec), "Brand: Curt Teich\nEra: Linen (1930-1945)\nTheme: Cowboys | Western");
});
