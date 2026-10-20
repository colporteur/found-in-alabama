// Run: npx tsx --test lib/shop/invoice-search.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { parseSearchInput, placeCandidates, placeQuery, searchPitchText, searchPitchUrl } from "./invoice-search";

test("parseSearchInput: words or a pasted link", () => {
  assert.deepEqual(parseSearchInput("Anniston", "fia"), { site: "fia", q: "Anniston" });
  assert.deepEqual(parseSearchInput("https://theephemeralstate.com/search?q=gulf+shores&min=5", "fia"), {
    site: "tes", q: "gulf shores", category: null, min: 5, max: null,
  });
  assert.equal(parseSearchInput("www.foundinalabama.com/search?q=bama&category=123", "tes")?.category, "123");
  assert.equal(parseSearchInput("https://example.com/search?q=x", "fia"), null);
  assert.equal(parseSearchInput("https://foundinalabama.com/shop/postcards", "fia"), null);
  assert.equal(parseSearchInput("   ", "fia"), null);
});

test("url and wording", () => {
  const ps = { site: "tes" as const, q: "Anniston" };
  assert.equal(searchPitchUrl(ps, "TES7K3QX9"), "https://theephemeralstate.com/search?q=Anniston&code=TES7K3QX9");
  assert.equal(searchPitchText(ps, 37), "theephemeralstate.com has 37 items matching “Anniston” in stock today");
  assert.equal(searchPitchText({ ...ps, label: "Anniston, Alabama pieces" }, 147), "theephemeralstate.com has over 140 Anniston, Alabama pieces in stock today");
});

test("place candidates from titles", () => {
  assert.deepEqual(placeCandidates(["Vintage Linen Postcard Noble Street Anniston Alabama 1940s"]), ["Anniston"]);
  const a = placeCandidates(["Vintage Linen Postcard Anniston Alabama 1940s"]);
  assert.equal(a[0], "Anniston");
  const b = placeCandidates(["RPPC Main Street Gatlinburg Tenn. c1950 Real Photo"]);
  assert.ok(b.includes("Gatlinburg"), JSON.stringify(b));
  const c = placeCandidates(["1950s Clay County Alabama Fair Program Ashland"]);
  assert.ok(c.includes("Clay County") && c.includes("Ashland"), JSON.stringify(c));
  const d = placeCandidates(["Gulf Shores AL Beach Linen Postcard"]);
  assert.ok(d.includes("Gulf Shores"), JSON.stringify(d));
  assert.deepEqual(placeCandidates(["Lot of 10 Pinback Buttons"]), []);
  assert.equal(placeQuery("Gulf Shores"), '"Gulf Shores"');
});
