// Run: npx tsx --test lib/listings/rules.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import {
  moveConditionUp,
  applyPriceRules,
  cleanDescription,
  cleanTitle,
  guidePromptText,
  nearest87,
  nextTier,
  parseIdentification,
  parseWriteOutput,
  parseWriterSettings,
  pickTier,
  rankCategories,
  suggestShipping,
  DEFAULT_WRITER_SETTINGS,
  type Identification,
} from "./rules";

const ident = (over: Partial<Identification> = {}): Identification => ({
  identification: "Linen postcard of Main Street, Anniston, Alabama",
  kind: "postcard",
  cardType: "linen",
  keywords: ["anniston", "alabama", "main street"],
  era: "1940s",
  places: ["Anniston, AL"],
  signed: false,
  estValueUsd: 8,
  difficulty: "simple",
  confidence: 0.9,
  notes: "",
  ...over,
});

test("settings fall back to defaults and reject junk", () => {
  assert.deepEqual(parseWriterSettings(null), DEFAULT_WRITER_SETTINGS);
  const s = parseWriterSettings({ models: { simple: "google/gemini-3-flash", premium: "bad model id!" }, maxPhotos: 40, floor: "4.87" });
  assert.equal(s.models.simple, "google/gemini-3-flash");
  assert.equal(s.models.premium, DEFAULT_WRITER_SETTINGS.models.premium);
  assert.equal(s.maxPhotos, DEFAULT_WRITER_SETTINGS.maxPhotos);
  assert.equal(s.floor, 4.87);
});

test("identify output is parsed defensively", () => {
  const id = parseIdentification('```json\n{"identification":"RPPC of a depot","kind":"postcard","card_type":"rppc","keywords":["depot","rppc"],"est_value_usd":"$18","difficulty":"general","confidence":1.4}\n```');
  assert.ok(id);
  assert.equal(id.cardType, "rppc");
  assert.equal(id.estValueUsd, 18);
  assert.equal(id.confidence, 1);
  assert.equal(parseIdentification("no json here"), null);
  // A non-postcard never keeps a postcard card type.
  assert.equal(parseIdentification('{"identification":"Bible","kind":"book","card_type":"rppc"}')?.cardType, "nonpostcard");
});

test("tier routing", () => {
  assert.equal(pickTier(ident()).tier, "simple");
  assert.equal(pickTier(ident({ kind: "artwork" })).tier, "premium");
  assert.equal(pickTier(ident({ signed: true })).tier, "premium");
  assert.equal(pickTier(ident({ estValueUsd: 120 })).tier, "premium");
  assert.equal(pickTier(ident({ estValueUsd: 40 })).tier, "general");
  assert.equal(pickTier(ident({ kind: "book" })).tier, "general");
  assert.equal(pickTier(ident(), { needs_review: true }).tier, "general");
  assert.equal(pickTier(null).tier, "general");
  assert.equal(nextTier("simple"), "general");
  assert.equal(nextTier("premium"), null);
});

test("titles: bin codes stripped, 80 characters, Vtg only when needed", () => {
  assert.equal(cleanTitle("New Title: Anniston Alabama Main Street Linen Postcard NA331"), "Anniston Alabama Main Street Linen Postcard");
  assert.equal(cleanTitle("Church Certificate PC12 1920s", "PC12"), "Church Certificate 1920s");
  const long = "Vintage Linen Postcard Main Street Looking North Anniston Alabama Curt Teich 1940s Unposted";
  const t = cleanTitle(long);
  assert.ok(t.length <= 80, t);
  assert.ok(t.startsWith("Vtg Linen"));
  assert.equal(cleanTitle("Vintage Postcard Selma"), "Vintage Postcard Selma");
  assert.equal(cleanTitle("VTG Cleveland Terminal Tower Brochure"), "Vtg Cleveland Terminal Tower Brochure");
});

test("descriptions: plain text, capped at 1,500 at a sentence end", () => {
  assert.equal(cleanDescription("<p>Hello <b>there</b>.</p><p>Second.</p>"), "Hello there.\nSecond.");
  const s = "This is a sentence about the card. ".repeat(60);
  const d = cleanDescription(s);
  assert.ok(d.length <= 1500 && d.length > 1000);
  assert.ok(d.endsWith("."));
});

test("price rules", () => {
  assert.equal(nearest87(12.1), 11.87);
  assert.equal(nearest87(12.5), 12.87);
  const base = { cardType: "linen", isPostcard: true, floor: 5.87, poshmarkFloor: 15 };
  assert.equal(applyPriceRules({ ...base, suggested: 3 }).price, 5.87);
  assert.equal(applyPriceRules({ ...base, suggested: 6, cardType: "rppc" }).price, 9.87);
  assert.equal(applyPriceRules({ ...base, suggested: 22 }).price, 19.99);
  assert.equal(applyPriceRules({ ...base, suggested: 22, isPostcard: false }).price, 21.87);
  assert.deepEqual(applyPriceRules({ ...base, suggested: 9 }).venuePrices, { poshmark: 15 });
  assert.equal(applyPriceRules({ ...base, suggested: 30 }).venuePrices, null);
});

test("shipping suggestion", () => {
  const pc = "Collectibles > Postcards & Supplies > Postcards > Topographical Postcards";
  assert.equal(suggestShipping({ price: 9.87, categoryPath: pc, kind: "postcard", weightOz: null }).profile, "envelope");
  assert.equal(suggestShipping({ price: 29.87, categoryPath: pc, kind: "postcard", weightOz: null }).profile, "calculated");
  assert.equal(suggestShipping({ price: 9.87, categoryPath: pc, kind: "postcard", weightOz: 6 }).profile, "calculated");
  assert.equal(suggestShipping({ price: 9.87, categoryPath: "Books & Magazines > Books", kind: "book", weightOz: 12 }).profile, "media");
});

test("category ranking prefers matching shelves", () => {
  const opts = [
    { id: "262042", path: "Collectibles > Postcards & Supplies > Postcards > Topographical Postcards", count: 2600 },
    { id: "261186", path: "Books & Magazines > Books", count: 838 },
    { id: "35975", path: "Collectibles > Transportation > Railroadiana & Trains > Photographs > Photographs", count: 150 },
  ];
  assert.equal(rankCategories(opts, "railroad depot photograph trains", 1)[0].id, "35975");
  assert.equal(rankCategories(opts, "postcard of anniston", 1)[0].id, "262042");
});

test("guide text keeps listing + pricing sections within budget", () => {
  const g = {
    id: "postcards",
    name: "Postcards",
    content: "Intro line\n## 1. Title Formula\nfront-load town\n## 9. Shop history\nlong story\n## 2. Pricing Rules\n$5-$10 linen\n",
  };
  const t = guidePromptText([g]);
  assert.match(t, /Title Formula/);
  assert.match(t, /Pricing Rules/);
  assert.doesNotMatch(t, /Shop history/);
  const big = { ...g, content: "## Title tips\n" + "x".repeat(50_000) };
  assert.ok(guidePromptText([big], 10_000).length < 10_200);
});

test("writer output validation", () => {
  const ok = parseWriteOutput(
    JSON.stringify({
      title: "Main Street Anniston Alabama Linen Postcard 1940s Curt Teich NA331",
      description: "Linen postcard showing Main Street in Anniston, Alabama, published by Curt Teich. Unposted.",
      condition: "pre-owned - good",
      ebay_category_id: "262042",
      item_specifics: { Type: "Linen", City: "Anniston", Brand: "unknown", Era: ["1940s"] },
      price: "8.5",
      confidence: 0.8,
      flags: ["check the corner crease"],
    }),
    { categoryIds: new Set(["262042"]) }
  );
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.value.title, "Main Street Anniston Alabama Linen Postcard 1940s Curt Teich");
  assert.equal(ok.value.condition, "Pre-owned - Good");
  assert.equal(ok.value.ebayCategoryId, "262042");
  assert.deepEqual(ok.value.itemSpecifics, { Type: "Linen", City: "Anniston", Era: ["1940s"] });
  assert.equal(ok.value.price, 8.5);
  const badCat = parseWriteOutput(JSON.stringify({ title: "A long enough title here", description: "d".repeat(60), ebay_category_id: "999" }), {
    categoryIds: new Set(["262042"]),
  });
  assert.ok(badCat.ok && badCat.value.ebayCategoryId === null);
  assert.equal(parseWriteOutput("sorry").ok, false);
});

test("a late condition paragraph moves up to second place", () => {
  const long = "Intro about the item.\n\n" + "Detail. ".repeat(130) + "\n\nCondition: light toning.";
  const moved = moveConditionUp(long);
  assert.ok(moved.indexOf("Condition:") < 40, moved.slice(0, 80));
  const short = "Intro.\n\nDetail.\n\nCondition: fine.";
  assert.equal(moveConditionUp(short), short);
});

test("store categories: only ids from the offered list, at most two", () => {
  const ok = parseWriteOutput(
    JSON.stringify({ title: "A long enough title here", description: "d".repeat(60), store_category_ids: ["54113704012", "999", "54147286012", "1"] }),
    { storeCategoryIds: new Set(["54113704012", "54147286012", "1"]) }
  );
  assert.ok(ok.ok && ok.value.storeCategoryIds.join(",") === "54113704012,54147286012");
});

test("unverified words are parsed and can be removed cleanly", async () => {
  const { parseWriteOutput, removeWords } = await import("./rules");
  const r = parseWriteOutput(JSON.stringify({
    title: "St. Paul Church Troy Indiana Perry County Postcard Early 1900s Antique",
    description: "Antique postcard of St. Paul church in Troy, Indiana, Perry County. Light corner wear.",
    condition: "Used", price: 7,
    unverified: [{ words: "Perry County", basis: "Troy, Indiana is in Perry County" }, "perry county", { words: "" }],
  }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.unverified, [{ words: "Perry County", basis: "Troy, Indiana is in Perry County" }]);
  assert.equal(removeWords(r.value.description, "Perry County"), "Antique postcard of St. Paul church in Troy, Indiana. Light corner wear.");
  assert.equal(removeWords("Church (Ontario County) Phelps NY", "ontario county"), "Church Phelps NY");
  assert.equal(removeWords("A, Magic Valley, B", "Magic Valley"), "A, B");
});

test("up87 rounds a minimum up to the next .87", async () => {
  const { up87 } = await import("./drafts");
  assert.equal(up87(5), 5.87);
  assert.equal(up87(5.87), 5.87);
  assert.equal(up87(5.9), 6.87);
  assert.equal(up87(9.99), 10.87);
  assert.equal(up87(10), 10.87);
});

test("phone numbers never reach a listing", async () => {
  const { stripPhoneNumbers } = await import("./rules.ts");
  const cases: Array<[string, string]> = [
    ["Call (205) 555-1234 today", "Call today"],
    ["Smith Hardware, 123 Main St. Phone 2-4471. Est. 1922", "Smith Hardware, 123 Main St. Est. 1922"],
    ["Dial ATlantic 3-4567 for service", "for service"],
    ["Toll free 1-800-555-1234.", "Toll free."],
    ["Tel. 555-1212", ""],
  ];
  for (const [inp] of cases) {
    const r = stripPhoneNumbers(inp);
    assert.ok(!/\d{3}[\s.\-]\d{4}|\d-\d{4}/.test(r.text), `${inp} → ${r.text}`);
    assert.ok(r.removed.length > 0, inp);
  }
  for (const keep of ["Used 1950-1960", "Teich code 2B-H924 (1942)", "Buffalo, N.Y. 14212, number 113459", "ISBN 0851316123", "Rand McNally 1956 road map"]) {
    const r = stripPhoneNumbers(keep);
    assert.equal(r.text, keep, keep);
    assert.equal(r.removed.length, 0, keep);
  }
});
