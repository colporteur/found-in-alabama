// Run: npx tsx --test lib/ebay/aspects.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { aspectPromptText, fitSpecifics, parseAspects } from "./aspects";

const RAW = {
  aspects: [
    { localizedAspectName: "Type", aspectConstraint: { aspectRequired: true, aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT", itemToAspectCardinality: "SINGLE" }, aspectValues: [{ localizedValue: "Linen" }, { localizedValue: "Real Photo (RPPC)" }] },
    { localizedAspectName: "Postage Condition", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "SELECTION_ONLY", itemToAspectCardinality: "SINGLE" }, aspectValues: [{ localizedValue: "Posted" }, { localizedValue: "Unposted" }] },
    { localizedAspectName: "Theme", aspectConstraint: { aspectUsage: "RECOMMENDED", aspectMode: "FREE_TEXT", itemToAspectCardinality: "MULTI" }, aspectValues: [{ localizedValue: "Cities & Towns" }] },
    { localizedAspectName: "Original/Licensed Reprint", aspectConstraint: { aspectUsage: "OPTIONAL", aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Original" }, { localizedValue: "Licensed Reprint" }] },
  ],
};

test("aspects parse and render for the prompt", () => {
  const a = parseAspects(RAW);
  assert.equal(a.length, 4);
  assert.equal(a[0].required, true);
  assert.equal(a[2].multi, true);
  const t = aspectPromptText(a);
  assert.match(t, /Type \(REQUIRED, one value\)/);
  assert.match(t, /Postage Condition .*choose from: Posted \| Unposted/);
  assert.match(t, /Original\/Licensed Reprint \(optional/);
});

test("specifics are fitted to the category", () => {
  const a = parseAspects(RAW);
  const r = fitSpecifics(
    { "postage condition": "posted", Theme: ["Cities & Towns", "Architecture", "Architecture"], Era: "1940s", "Original/Licensed Reprint": "Reprint?" },
    a
  );
  assert.deepEqual(r.kept, { "Postage Condition": "Posted", Theme: ["Cities & Towns", "Architecture"] });
  assert.ok(r.dropped.some((d) => /Era/.test(d)));
  assert.ok(r.dropped.some((d) => /Reprint\?/.test(d)));
  assert.deepEqual(r.missingRequired, ["Type"]);
});
