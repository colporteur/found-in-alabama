// Run: npx tsx --test lib/search/query.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SYNONYMS, didYouMean, norm, parseQuery, parseSynonyms, prefixTsquery, tokenize } from "./query";
import { readSearchParams, searchHref } from "./page-params";

const syn = parseSynonyms(DEFAULT_SYNONYMS);

test("norm: lowercase, accents and punctuation away", () => {
  assert.equal(norm("  Café—Birmingham, AL!! "), "cafe birmingham al");
  assert.equal(norm("T-Town"), "t town");
});

test("tokenize: quoted phrases, exclusions", () => {
  const t = tokenize('"Crimson Tide" mug -reproduction');
  assert.deepEqual(t.terms, [{ text: "crimson tide", phrase: true }, { text: "mug", phrase: false }]);
  assert.deepEqual(t.exclude, ["reproduction"]);
});

test("parseQuery: synonyms both ways, multi-word phrases matched longest first", () => {
  const p = parseQuery("bham postcards", syn);
  assert.deepEqual(p.groups[0].sort(), ["bham", "birmingham"]);
  assert.deepEqual(p.groups[1], ["postcards"]);
  const u = parseQuery("University of Alabama yearbook", syn);
  assert.equal(u.groups.length, 2);
  assert.ok(u.groups[0].includes("bama") && u.groups[0].includes("crimson tide"));
  const q = parseQuery('"roll tide"', syn);
  assert.ok(q.groups[0].includes("university of alabama"));
  const tt = parseQuery("t-town", syn);
  assert.ok(tt.groups[0].includes("tuscaloosa"));
  assert.equal(parseQuery("", syn).groups.length, 0);
});

test("prefix query for suggestions", () => {
  assert.equal(prefixTsquery("birm"), "birm:*");
  assert.equal(prefixTsquery("Mobile ma"), "mobile & ma:*");
  assert.equal(prefixTsquery("  !! "), null);
});

test("did you mean", () => {
  assert.equal(didYouMean("birmingam postcard", new Map([["birmingam", "birmingham"]])), "birmingham postcard");
  assert.equal(didYouMean("postcard", new Map()), null);
});

test("search page params and links", () => {
  const p = readSearchParams({ q: "linen", category: "123", min: "5", sort: "price-asc", page: "2" });
  assert.deepEqual(p, { q: "linen", category: "123", min: 5, max: null, sort: "price-asc", page: 2 });
  assert.equal(readSearchParams({ q: "x" }).sort, "best");
  assert.equal(readSearchParams({}).sort, "newest");
  assert.equal(searchHref(p, { category: "" }), "/search?q=linen&min=5&sort=price-asc");
  assert.equal(searchHref(p, { page: 3 }), "/search?q=linen&category=123&min=5&sort=price-asc&page=3");
});
