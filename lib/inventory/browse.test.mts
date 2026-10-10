// Run: npx tsx --test lib/inventory/browse.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { browseHref, diffEdit, parseBrowseQuery } from "./browse";

test("query parsing keeps only valid values", () => {
  const q = parseBrowseQuery({ q: " birmingham ", status: "sold", venue: "off:mercari", min: "$5", max: "x", from: "2026-01-01", to: "bad", sort: "nope", view: "grid", page: "3" });
  assert.equal(q.q, "birmingham");
  assert.equal(q.status, "sold");
  assert.equal(q.venue, "off:mercari");
  assert.equal(q.minPrice, 5);
  assert.equal(q.maxPrice, null);
  assert.equal(q.from, "2026-01-01");
  assert.equal(q.to, null);
  assert.equal(q.sort, "newest");
  assert.equal(q.view, "grid");
  assert.equal(q.page, 3);
  assert.equal(parseBrowseQuery({ venue: "on:evil'site", status: "deleted" }).venue, null);
  assert.equal(parseBrowseQuery({ status: "deleted" }).status, "live");
});

test("hrefs round-trip and drop defaults", () => {
  const q = parseBrowseQuery({ q: "lp", bin: "LT*", view: "grid" });
  assert.equal(browseHref(q), "/admin/inventory?q=lp&bin=LT*&view=grid");
  assert.equal(browseHref(q, { page: 2, status: "all" }), "/admin/inventory?q=lp&status=all&bin=LT*&view=grid&page=2");
  assert.deepEqual(parseBrowseQuery(Object.fromEntries(new URL("http://x" + browseHref(q)).searchParams)), q);
});

test("diffEdit finds real changes only", () => {
  const cur = { title: "Old Title", binSku: "LT1", status: "live", notes: null, soldOnVenue: null };
  assert.deepEqual(diffEdit(cur, { title: "  Old   Title ", binSku: "LT1", notes: "" }), []);
  const d = diffEdit(cur, { title: "New Title", binSku: "", status: "sold", soldOnVenue: "Mercari", notes: "chip on corner" });
  assert.deepEqual(d.map((c) => c.field), ["title", "bin_sku", "status", "sold_on_venue", "notes"]);
  assert.equal(d[1].to, null);
  assert.equal(d[3].to, "mercari");
  assert.throws(() => diffEdit(cur, { title: "  " }));
  assert.throws(() => diffEdit(cur, { status: "deleted" as never }));
  // sold venue is ignored unless the item ends up sold
  assert.deepEqual(diffEdit(cur, { soldOnVenue: "ebay" }), []);
});
