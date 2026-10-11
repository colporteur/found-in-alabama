const test = require("node:test");
const assert = require("node:assert/strict");
const { niftyListedPages } = require("./nifty-listed.js");

function fakeGet(pages, total) {
  const calls = [];
  return {
    calls,
    get: async (input) => {
      calls.push(input);
      return { total, items: pages[input.page] || [] };
    },
  };
}

const item = (id, mk) => ({ id, title: "T " + id, privateNotes: "SKU: PC1", skus: ["PC1"], marketplaceMetadata: mk, description: "long" });

test("reads Listed oldest first, a chunk at a time, read-only", async () => {
  const f = fakeGet([[item("a", { eBay: { externalId: "1", status: "LISTED" }, Mercari: { externalId: "m1", status: "LISTED" } })], [item("b", {})]], 2);
  const r = await niftyListedPages(0, 1, { get: f.get, pauseMs: 0 });
  assert.equal(r.items.length, 1);
  assert.equal(r.nextPage, 1);
  assert.equal(r.done, false);
  assert.equal(r.total, 2);
  assert.equal(f.calls[0].filter, "listed");
  assert.equal(f.calls[0].sortOrder, "asc");
  assert.deepEqual(r.items[0].marketplaces.Mercari, { externalId: "m1", status: "LISTED", pictureUrl: null, price: null });
  assert.equal(r.items[0].status, "LISTED");
  assert.equal("description" in r.items[0], false);
});

test("stops at the first empty page", async () => {
  const f = fakeGet([[item("a", {})]], 1);
  const r = await niftyListedPages(0, 5, { get: f.get, pauseMs: 0 });
  assert.equal(r.done, true);
  assert.equal(r.items.length, 1);
  assert.equal(f.calls.length, 2);
});
