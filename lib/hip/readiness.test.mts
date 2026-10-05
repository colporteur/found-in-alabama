// Run: npx tsx --test lib/hip/readiness.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { buildReadinessReport, readinessCsv, suggestHipCategory, type HipSnapshot, type InventoryCandidate } from "./readiness";
import { collectHipReadinessSnapshot, parseHipReadinessPage } from "./readiness-snapshot";
import { tesQualifyingSet } from "../tes/selection";
import { hipReadinessConnection } from "./readiness-connection";
import { hipConfigured } from "./client";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const now = new Date("2026-09-17T18:00:00Z");
const item: InventoryCandidate = {
  itemId: "128040896736", title: "Florida linen postcard", sku: "Postcards 42", price: "5.82", quantity: 1,
  description: "<p>Vintage postcard &amp; reverse shown.</p>", primaryImageUrl: "https://i.ebayimg.com/front.jpg",
  imageUrls: ["https://i.ebayimg.com/front.jpg", "https://i.ebayimg.com/back.jpg"],
  siteCategoryId: "262042", siteCategoryName: "Collectibles:Postcards &amp; Supplies:Postcards:Topographical Postcards",
  listingType: "FixedPriceItem", lastSyncedAt: now, storeCategories: ["Florida", "Postcards"],
};
const complete: HipSnapshot = { state: "complete", listings: [], pages: 1, checkedAt: now.toISOString(), message: "Complete" };
const classify = (changes: Partial<InventoryCandidate> = {}, scan: Partial<HipSnapshot> = {}) => buildReadinessReport([{ ...item, ...changes }], { ...complete, ...scan }, true, now).rows[0];

test("shared selection inherits parent flags and terminates category cycles", () => {
  const set = tesQualifyingSet([
    { categoryId: "p", parentCategoryId: null, isEphemeralState: true },
    { categoryId: "c", parentCategoryId: "p", isEphemeralState: false },
    { categoryId: "g", parentCategoryId: "c", isEphemeralState: false },
    { categoryId: "x", parentCategoryId: "y", isEphemeralState: false },
    { categoryId: "y", parentCategoryId: "x", isEphemeralState: false },
  ]);
  assert.deepEqual([...set], ["p", "c", "g"]);
});
test("a complete empty Hip scan permits pilot review; category zero is valid", () => {
  const row = classify();
  assert.equal(row.status, "ready");
  assert.equal(row.category?.id, 0);
  assert.equal(row.imageCount, 2);
  assert.equal(row.descriptionPreview, "Vintage postcard & reverse shown.");
});
test("an absent connection, failure, or partial scan cannot confirm a missing listing", () => {
  for (const state of ["not_connected", "not_checked", "error", "partial"] as const) assert.equal(classify({}, { state }).status, "unchecked");
});
test("exact eBay IDs match even when titles change", () => {
  assert.equal(classify({}, { listings: [{ id: 10, name: "Changed title", externalId: item.itemId, privateId: null }] }).status, "listed");
});
test("bin labels and title-only matches never prove identity", () => {
  assert.equal(classify({}, { listings: [{ id: 10, name: "Another item", externalId: null, privateId: item.sku }] }).status, "ready");
  const row = classify({}, { listings: [{ id: 10, name: "FLORIDA  linen postcard", externalId: null, privateId: item.sku }] });
  assert.equal(row.status, "needs_review");
  assert.deepEqual(row.possibleHipIds, [10]);
  assert.deepEqual(row.hipIds, []);
});
test("our reserved private identifier maps correctly", () => {
  assert.equal(classify({}, { listings: [{ id: 10, name: "Different title", externalId: null, privateId: `tes-ebay:${item.itemId}` }] }).status, "listed");
});
test("duplicate external identifiers block new publication", () => {
  const listings = [10, 11].map((id) => ({ id, name: item.title, externalId: item.itemId, privateId: null }));
  assert.equal(classify({}, { listings }).status, "needs_review");
});
test("missing and overlength data is held for repair", () => {
  for (const changes of [{ description: null }, { description: "x".repeat(8001) }, { imageUrls: [], primaryImageUrl: null }, { price: "0" }, { title: "x".repeat(81) }]) {
    assert.equal(classify(changes).status, "needs_data");
  }
});
test("stock freshness, quantity and selling format limit pilot eligibility", () => {
  assert.equal(classify({ lastSyncedAt: "2026-09-14T00:00:00Z" }).status, "needs_review");
  assert.equal(classify({ quantity: 2 }).status, "needs_review");
  assert.equal(classify({ listingType: "Chinese" }).status, "needs_review");
});
test("a state store category does not turn an unknown object into a postcard", () => {
  assert.equal(classify({ siteCategoryId: "165811", siteCategoryName: "Collectibles:Souvenirs:Florida" }).status, "needs_category");
});
test("pilot exclusions are separate from unknown categories", () => {
  assert.equal(classify({ siteCategoryId: "261328", siteCategoryName: "Sports Mem, Cards & Fan Shop:Sports Trading Cards:Trading Card Singles" }).status, "excluded");
  assert.equal(classify({ siteCategoryId: "29223", siteCategoryName: "Books & Magazines:Antiquarian & Collectible" }).status, "needs_category");
});
test("ephemera maps by item type, without classifying mixed holiday cards as postcards", () => {
  assert.equal(suggestHipCategory({ siteCategoryId: "35890", siteCategoryName: "Collectibles:Paper:Vintage Greeting Cards:Birthday" })?.id, 36513);
  assert.equal(suggestHipCategory({ siteCategoryId: "261634", siteCategoryName: "Collectibles:Holiday & Seasonal:Cards & Postcards" }), null);
});
test("unmatched Hip inventory remains visible; partial matches do not hide scan failure", () => {
  const report = buildReadinessReport([item], { ...complete, state: "partial", listings: [
    { id: 10, name: "Current", externalId: item.itemId, privateId: null },
    { id: 11, name: "Outside selection", externalId: "123", privateId: null },
  ] }, true, now);
  assert.equal(report.rows[0].status, "listed");
  assert.equal(report.snapshot.state, "partial");
  assert.deepEqual(report.hipUnmatched.map((l) => l.id), [11]);
  assert.equal(Object.values(report.counts).reduce((a, b) => a + b, 0), 1);
});
test("CSV escapes quotes and neutralizes spreadsheet formulas", () => {
  const csv = readinessCsv([classify({ title: '=HYPERLINK("bad")' })]);
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
});
test("malformed responses and non-active records cannot look like an empty store", () => {
  for (const raw of [{}, { results: null }, { results: [{ id: "bad", name: "x" }] }, { results: [{ id: 1, name: "x", closed: 1 }] }]) assert.throws(() => parseHipReadinessPage(raw));
  assert.equal(parseHipReadinessPage({ results: [{ id: "1", name: "x", external_id: "123", external_id_type: "other" }] })[0].externalId, null);
});
test("scan walks short pages until an empty page, with GET-only callback", async () => {
  const calls: number[] = [];
  const result = await collectHipReadinessSnapshot(async (p) => { calls.push(p); return { results: p < 3 ? [{ id: p, name: "Item" }] : [] }; }, { pause: async () => {} });
  assert.equal(result.state, "complete");
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.listings.length, 2);
});
test("page caps, repeated pages, and failures remain incomplete", async () => {
  const options = { maxPages: 2, pause: async () => {} };
  const capped = await collectHipReadinessSnapshot(async (p) => ({ results: [{ id: p, name: "x" }] }), options);
  const repeated = await collectHipReadinessSnapshot(async () => ({ results: [{ id: 1, name: "x" }] }), options);
  const failed = await collectHipReadinessSnapshot(async () => { throw new Error("Timeout"); }, options);
  assert.equal(capped.state, "partial");
  assert.equal(repeated.state, "partial");
  assert.equal(failed.state, "error");
});

test("the local audit connection does not enable sale or delist integrations", () => {
  const names = ["HIP_API_KEY", "HIP_USERNAME", "HIP_READINESS_API_KEY_FILE", "HIP_READINESS_USERNAME"];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  const dir = mkdtempSync(join(tmpdir(), "hip-readiness-test-"));
  const path = join(dir, "test-key.txt");
  try {
    delete process.env.HIP_API_KEY;
    delete process.env.HIP_USERNAME;
    writeFileSync(path, "test-only-key");
    process.env.HIP_READINESS_API_KEY_FILE = path;
    process.env.HIP_READINESS_USERNAME = "test-store";
    assert.equal(hipReadinessConnection()?.username, "test-store");
    assert.equal(hipReadinessConnection()?.base, "https://www.hippostcard.com/api");
    assert.equal(hipConfigured(), false);
    process.env.HIP_READINESS_API_KEY_FILE = join(dir, "missing.txt");
    assert.equal(hipReadinessConnection(), null);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    unlinkSync(path);
    rmdirSync(dir);
  }
});

test("Hip report links accept only the marketplace origin", () => {
  const rows = parseHipReadinessPage({ results: [
    { id: 1, name: "x", url: "https://www.hippostcard.com/listing/x/1" },
    { id: 2, name: "x", url: "javascript:alert(1)" },
    { id: 3, name: "x", url: "https://example.com/x" },
  ] });
  assert.equal(rows[0].url, "https://www.hippostcard.com/listing/x/1");
  assert.equal(rows[1].url, undefined);
  assert.equal(rows[2].url, undefined);
});
