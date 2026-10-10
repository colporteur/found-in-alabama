// Run: node --test nifty-bridge.test.cjs
// Fake Nifty API (shapes copied from real responses, Oct 8 2026).
const test = require("node:test");
const assert = require("node:assert/strict");
const { niftyBridgeSend } = require("./nifty-bridge.js");

const A = (id, name, section, extra = {}) => ({ id, name, section, required: false, type: "taxonomy-enum-attribute", members: [], ...extra });
const EBAY_TAX = {
  attributes: [
    A("ship", "Shipping policy", "SHIPPING", { required: true }),
    A("offers", "Allow best offers?", "PRICING", { required: true }),
    A("era", "Era", "SPECIFIC", { members: [{ id: "m-linen", externalId: "linen", name: "Linen (1930-1945)" }] }),
    A("city", "City", "SPECIFIC", { allowFreeSolo: true }),
    A("subject", "Subject", "SPECIFIC"),
    A("store", "Store categories", "SELLER_COLLECTION", { dynamicProviderId: "dp1", maxValues: 2 }),
  ],
};
const MERCARI_TAX = { attributes: [A("label", "Shipping label", "SHIPPING", { required: true }), A("floor", "Floor price", "PRICING", { required: true }), A("color", "Color", "COLOR")] };
const POSH_TAX = { attributes: [A("size", "Size", "SIZE", { required: true }), A("tags", "Style tags", "TAGS")] };

function fakeApi() {
  const calls = [];
  const template = {
    media: { pictures: [], videos: [], marketplace: "eBay" },
    inventoryItem: {
      title: "Template",
      sourceMarketplace: "Poshmark",
      category: { id: "posh-cat", namePath: ["Home"], name: "Art", marketplace: "Poshmark" },
      attributeValues: [{ type: "enum-attribute-values", id: "size", values: [{ type: "taxonomy-enum-member", id: "os", name: "One Size" }] }, { type: "enum-attribute-values", id: "tags", values: [] }],
    },
    marketplaceListings: [
      {
        marketplace: "eBay",
        category: { id: "tpl-ebay-cat", namePath: ["Collectibles", "Paper"], name: "Ephemera" },
        attributeValues: [
          { type: "enum-attribute-values", id: "ship", values: [{ name: "Calculated" }] },
          { type: "enum-attribute-values", id: "offers", values: [{ name: "Yes" }] },
          { type: "enum-attribute-values", id: "subject", values: [{ name: "Template subject" }] },
          { type: "enum-attribute-values", id: "store", values: [{ externalId: "old" }] },
        ],
      },
      { marketplace: "Mercari", category: { id: "merc-cat" }, attributeValues: [{ type: "enum-attribute-values", id: "label", values: [] }, { type: "enum-attribute-values", id: "color", values: [] }] },
      { marketplace: "Poshmark", category: { id: "posh-cat" }, attributeValues: [{ type: "enum-attribute-values", id: "size", values: [] }] },
    ],
  };
  let saved = null;
  return {
    calls,
    async get(proc, input) {
      calls.push(["GET", proc, input]);
      if (proc === "inventory.getInventoryItem") {
        if (input.inventoryItemId === "tpl") return template;
        return { marketplaceListings: (saved?.marketplaceListings || []).map((l) => ({ marketplace: l.marketplace, status: "DRAFTED" })) };
      }
      if (proc === "taxonomy.getCategories") return [{ id: "nifty-topo", namePath: ["Collectibles", "Postcards & Supplies", "Postcards"], name: "Topographical Postcards", isSelectable: true }];
      if (proc === "taxonomy.getMarketplaceTaxonomy") return { eBay: EBAY_TAX, Mercari: MERCARI_TAX, Poshmark: POSH_TAX }[input.marketplace];
      if (proc === "taxonomy.loadDynamicProvider") return [{ id: "store", members: [{ id: "s-uuid-1", externalId: "54113704012" }, { id: "s-uuid-2", externalId: "54147286012" }] }];
      throw new Error("unexpected GET " + proc);
    },
    async post(proc, input) {
      calls.push(["POST", proc, input]);
      assert.equal(proc, "inventory.saveAsDraftV2");
      saved = input;
      return { draftId: input.inventoryItemId };
    },
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(),
  };
}

const DRAFT = {
  templateId: "tpl",
  title: "Main Street Anniston Alabama Linen Postcard",
  description: "Linen postcard.",
  condition: "Pre-owned - Fair",
  conditionNote: "Corner wear",
  price: 9.87,
  venuePrices: { poshmark: 15 },
  quantity: 1,
  sku: "PC12",
  privateNotes: "FIA abcd1234 | SKU: PC12",
  photos: ["https://photos.foundinalabama.com/a.jpg", "https://photos.foundinalabama.com/b.jpg"],
  ebayCategoryPath: "Collectibles > Postcards & Supplies > Postcards > Topographical Postcards",
  itemSpecifics: { Era: "Linen (1930-1945)", City: "Anniston", Subject: "Main Street", Bogus: "x" },
  storeCategoryIds: ["54113704012", "54147286012"],
};

test("builds a full Nifty draft and only ever calls saveAsDraftV2", async () => {
  const api = fakeApi();
  const out = await niftyBridgeSend(DRAFT, { api });
  assert.equal(out.ok, true, out.error);
  const posts = api.calls.filter((c) => c[0] === "POST");
  assert.equal(posts.length, 1);
  const p = posts[0][2];
  assert.equal(p.lifecycleStatus, "IN_PROGRESS");
  assert.equal(p.inventoryItem.condition, "FAIR");
  assert.equal(p.inventoryItem.sku, "PC12");
  assert.equal(p.inventoryItem.category, "posh-cat");
  assert.deepEqual(p.inventoryItem.attributeValues.map((v) => v.id), ["size"]); // tags dropped
  assert.deepEqual(p.media.pictures.map((x) => x.type), ["external", "external"]);
  const eb = p.marketplaceListings.find((l) => l.marketplace === "eBay");
  assert.equal(eb.category, "nifty-topo");
  assert.equal(eb.price, 9.87);
  const ids = eb.attributeValues.map((v) => v.id).sort();
  assert.deepEqual(ids, ["city", "era", "offers", "ship", "store"]); // template's subject dropped; ours not allowed
  assert.equal(eb.attributeValues.find((v) => v.id === "era").values[0].type, "taxonomy-enum-member");
  assert.equal(eb.attributeValues.find((v) => v.id === "city").values[0].type, "taxonomy-enum-free-solo");
  assert.deepEqual(eb.attributeValues.find((v) => v.id === "store").values.map((v) => v.id), ["s-uuid-1", "s-uuid-2"]);
  assert.equal(p.marketplaceListings.find((l) => l.marketplace === "Poshmark").price, 15);
  const merc = p.marketplaceListings.find((l) => l.marketplace === "Mercari");
  assert.deepEqual(merc.attributeValues.map((v) => v.id), ["label"]); // color dropped
  assert.ok(out.warnings.some((w) => /Bogus/.test(w)));
  assert.ok(out.warnings.some((w) => /Main Street/.test(w)));
  assert.ok(!out.warnings.some((w) => /Floor price/.test(w))); // template had no floor price either
});

test("dry run sends nothing", async () => {
  const api = fakeApi();
  const out = await niftyBridgeSend(DRAFT, { api, dryRun: true });
  assert.equal(out.dryRun, true);
  assert.equal(api.calls.filter((c) => c[0] === "POST").length, 0);
});

test("stops loudly if Nifty lists the item", async () => {
  const api = fakeApi();
  const realGet = api.get;
  api.get = async (proc, input) =>
    proc === "inventory.getInventoryItem" && input.inventoryItemId !== "tpl"
      ? { marketplaceListings: [{ marketplace: "eBay", status: "LISTED" }] }
      : realGet(proc, input);
  const out = await niftyBridgeSend(DRAFT, { api });
  assert.equal(out.ok, false);
  assert.match(out.error, /LISTED/);
});

test("the built-in API refuses any write but saveAsDraftV2", async () => {
  // Without an injected api the bridge uses fetch; make sure addItemV2 can't slip through.
  const src = require("node:fs").readFileSync(__dirname + "/nifty-bridge.js", "utf8");
  assert.match(src, /if \(proc !== "inventory\.saveAsDraftV2"\) throw/);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /post\("inventory\.addItemV2"/);
});

// ── weight (Oct 9): FIA's weight replaces the template's ─────────────────────
test("weight goes onto eBay/Mercari package weight, Mercari label, Depop parcel, Whatnot profile", async () => {
  const N = (id, name, section, extra = {}) => ({ id, name, section, required: false, type: "taxonomy-enum-attribute", members: [], ...extra });
  const W = (lb, oz) => ({ type: "numeric-attribute-values", id: "pw", values: [{ value: lb, id: "s-lb" }, { value: oz, id: "s-oz" }] });
  const tax = {
    eBay: { attributes: [N("pw", "Package weight", "SHIPPING", { type: "numeric-attribute" })] },
    Mercari: { attributes: [N("pw", "Package weight", "SHIPPING", { type: "numeric-attribute" }), N("ml", "Shipping label", "SHIPPING", { dynamicProviderId: "dp-ml" })] },
    Depop: { attributes: [N("dp", "Parcel size", "SHIPPING", { dynamicProviderId: "dp-dp" })] },
    Whatnot: { attributes: [N("wp", "Shipping profile", "SHIPPING", { dynamicProviderId: "dp-wp" })] },
  };
  const dyn = {
    "dp-ml": [{ id: "ml", members: [{ id: "lbl-1", externalId: "ga-8oz", name: "USPS Ground Advantage - $5.75" }, { id: "lbl-2", externalId: "pri", name: "Priority" }] }],
    "dp-dp": [{ id: "dp", members: ["under_4oz", "under_8oz", "under_12oz", "under_1lb", "under_2lb"].map((x) => ({ id: "d-" + x, externalId: x, name: x })) }],
    "dp-wp": [{ id: "wp", members: ["Media 1 lb", "Media 4 lbs", "0-1 oz", "1-3 oz", "4-7 oz", "8-11 oz", "12-15 oz", "1 lb", "1-2 lbs"].map((x) => ({ id: "w-" + x, externalId: x, name: x })) }],
  };
  const template = {
    media: { pictures: [], videos: [] },
    inventoryItem: { title: "T", sourceMarketplace: "Poshmark", category: { id: "c" }, attributeValues: [] },
    marketplaceListings: [
      { marketplace: "eBay", category: { id: "e", namePath: [], name: "x" }, attributeValues: [W(0, 12)] },
      { marketplace: "Mercari", category: { id: "m" }, attributeValues: [W(0, 12), { type: "enum-attribute-values", id: "ml", values: [{ type: "taxonomy-enum-dynamically-loaded-value", id: "old" }] }] },
      { marketplace: "Depop", category: { id: "d" }, attributeValues: [{ type: "enum-attribute-values", id: "dp", values: [{ type: "taxonomy-enum-dynamically-loaded-value", id: "d-under_12oz" }] }] },
      { marketplace: "Whatnot", category: { id: "w" }, attributeValues: [{ type: "enum-attribute-values", id: "wp", values: [{ type: "taxonomy-enum-dynamically-loaded-value", id: "w-1 lb" }] }] },
    ],
  };
  const ctx = [];
  const api = {
    async get(proc, input) {
      if (proc === "inventory.getInventoryItem") return template;
      if (proc === "taxonomy.getMarketplaceTaxonomy") return tax[input.marketplace] || { attributes: [] };
      if (proc === "taxonomy.loadDynamicProvider") {
        ctx.push([input.dynamicProviderId, JSON.stringify(input.dynamicProviderContext)]);
        return dyn[input.dynamicProviderId];
      }
      throw new Error("unexpected " + proc);
    },
    async post() {
      throw new Error("dry run must not post");
    },
    uuid: () => "00000000-0000-4000-8000-000000000001",
  };
  const draft = { templateId: "tpl", title: "Program", description: "d", condition: "Used", price: 12.87, quantity: 1, photos: ["https://x/1.jpg"], weightOz: 20 };
  const r = await niftyBridgeSend(draft, { dryRun: true, api });
  const L = Object.fromEntries(r.payload.marketplaceListings.map((l) => [l.marketplace, l.attributeValues]));
  const get = (mkt, id) => L[mkt].find((v) => v.id === id);
  assert.deepEqual(get("eBay", "pw").values.map((x) => x.value), [1, 4]);
  assert.deepEqual(get("Mercari", "pw").values.map((x) => [x.id, x.value]), [["s-lb", 1], ["s-oz", 4]]);
  assert.equal(get("Mercari", "ml").values[0].id, "lbl-1");
  // Mercari's label options were asked for WITH the new weight.
  assert.match(ctx.find((c) => c[0] === "dp-ml")[1], /"value":1.*"value":4/);
  assert.equal(get("Depop", "dp").values[0].id, "d-under_2lb");
  assert.equal(get("Whatnot", "wp").values[0].id, "w-1-2 lbs");

  // 12 oz paper: Depop under_1lb? no — under_12oz is < 12, so under_1lb; Whatnot 12-15 oz.
  const r2 = await niftyBridgeSend({ ...draft, weightOz: 12 }, { dryRun: true, api });
  const L2 = Object.fromEntries(r2.payload.marketplaceListings.map((l) => [l.marketplace, l.attributeValues]));
  assert.equal(L2.Depop.find((v) => v.id === "dp").values[0].id, "d-under_1lb");
  assert.equal(L2.Whatnot.find((v) => v.id === "wp").values[0].id, "w-12-15 oz");

  // No weight: template values kept, with a warning.
  const r3 = await niftyBridgeSend({ ...draft, weightOz: null }, { dryRun: true, api });
  assert.ok(r3.warnings.some((w) => /No weight/.test(w)));
  assert.deepEqual(r3.payload.marketplaceListings[0].attributeValues.find((v) => v.id === "pw").values.map((x) => x.value), [0, 12]);
});
