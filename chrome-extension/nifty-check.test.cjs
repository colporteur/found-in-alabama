// Run: node --test chrome-extension/nifty-check.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { niftyRecentSold } = require("./nifty-check.js");

const item = (id, soldAt) => ({
  id, title: "T" + id, status: "SOLD", soldAt, privateNotes: "", skus: ["LT1"],
  marketplaceMetadata: {
    Mercari: { externalId: "m" + id, status: "SOLD", price: 9 },
    Poshmark: { externalId: "p" + id, status: "DELISTED", price: 15 },
    Depop: { externalId: "d" + id, status: "LISTED" },
  },
});

test("pages newest-first until the cutoff, read-only", async () => {
  const calls = [];
  const pages = [
    [item("a", "2026-10-10T10:00:00Z"), item("b", "2026-10-09T10:00:00Z")],
    [item("c", "2026-10-08T10:00:00Z"), item("d", "2026-10-01T10:00:00Z")],
    [item("e", "2026-09-01T10:00:00Z")],
  ];
  const r = await niftyRecentSold("2026-10-05T00:00:00Z", {
    pauseMs: 0,
    get: async (input) => {
      calls.push(input);
      assert.equal(input.filter, "sold");
      assert.equal(input.sort, "sale_detected_at");
      return { items: pages[input.page] || [] };
    },
  });
  assert.deepEqual(r.items.map((i) => i.niftyId), ["a", "b", "c"]);
  assert.equal(r.complete, true);
  assert.equal(calls.length, 2);
  assert.equal(r.items[0].marketplaces.Depop.status, "LISTED");
  assert.equal(r.items[0].price, 9);
});

test("stops at an empty page", async () => {
  const r = await niftyRecentSold("2026-01-01T00:00:00Z", { pauseMs: 0, get: async () => ({ items: [] }) });
  assert.equal(r.items.length, 0);
  assert.equal(r.pages, 1);
  assert.equal(r.complete, false);
});
