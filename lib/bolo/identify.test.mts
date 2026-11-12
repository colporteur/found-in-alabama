// Run: npx tsx --test lib/bolo/identify.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { parseBoloReply } from "./identify";

test("reads a fenced JSON reply", () => {
  const r = parseBoloReply(
    '```json\n{"name":"Pledge Clean It Multi-Surface Fresh Citrus 16 oz","category":"Cleaners & polish","query":"Pledge Clean It Fresh Citrus 16 oz","comp":"$49.99 / 3-pack","kind":"sold","status":"discontinued","note":"Blue bottle.","source":"https://www.ebay.com/itm/1","confidence":0.9}\n```'
  );
  assert.equal(r?.category, "Cleaners & polish");
  assert.equal(r?.kind, "sold");
  assert.equal(r?.status, "discontinued");
  assert.equal(r?.source, "https://www.ebay.com/itm/1");
});

test("still in stores becomes a Trap at retail", () => {
  const r = parseBoloReply(
    'Here you go: {"name":"Pledge Restoring Orange Oil","category":"Cleaners & polish","comp":"$6.99","kind":"asking","status":"still sold","confidence":"0.8"}'
  );
  assert.equal(r?.category, "Traps");
  assert.equal(r?.kind, "retail");
  assert.equal(r?.query, "Pledge Restoring Orange Oil");
  assert.equal(r?.confidence, 0.8);
});

test("unknown values fall back safely", () => {
  const r = parseBoloReply('{"name":"Mystery spray","category":"Kitchen","kind":"sold","status":"maybe","source":"not a url","confidence":7}');
  assert.equal(r?.category, "Other");
  assert.equal(r?.status, "unsure");
  assert.equal(r?.source, undefined);
  assert.equal(r?.confidence, 1);
  assert.equal(r?.comp, "Check comps");
  assert.match(r!.note!, /^Not confirmed/);
});

test("unreadable replies return null", () => {
  assert.equal(parseBoloReply("sorry, I can't tell"), null);
  assert.equal(parseBoloReply('{"name":""}'), null);
});
