// Full inventory check (Phase 1 / readiness test 1): read EVERY item in
// Nifty's Listed view, a few pages per call, oldest first (so listings
// created during the run land at the end instead of shifting pages), with
// every marketplace's status. popup.js posts each chunk to FIA's capture
// endpoint, which records where each item is live on Mercari, Poshmark,
// Depop and Whatnot; at the end FIA marks listings Nifty no longer shows as
// ended.
//
// READ-ONLY: one GET procedure (inventory.getInventory). Nothing in Nifty
// changes. Runs in the app.nifty.ai tab (MAIN world).

/* eslint-disable no-unused-vars */
async function niftyListedPages(startPage, pageCount, options) {
  const opts = Object.assign({ pauseMs: 250, get: null }, options || {});
  const get =
    opts.get ||
    (async (input) => {
      const url = "https://api.nifty.ai/api/v1/inventory.getInventory?input=" + encodeURIComponent(JSON.stringify(input));
      const r = await fetch(url, { credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error("inventory.getInventory: " + ((j.error && j.error.message) || "HTTP " + r.status));
      return j.result ? j.result.data : j;
    });

  const out = [];
  let total = null;
  let done = false;
  let page = startPage;
  for (; page < startPage + pageCount; page++) {
    const data = await get({
      query: "",
      page,
      filter: "listed",
      search: "all_fields",
      sort: "created_at",
      sortOrder: "asc",
      warning: "all",
      marketplaces: { include: [], exclude: [] },
      labels: { include: [], exclude: [] },
    });
    if (data && data.total != null) total = Number(data.total);
    const items = (data && data.items) || [];
    for (const c of items) {
      const marketplaces = {};
      let hero = null;
      let price = null;
      for (const [mp, v] of Object.entries(c.marketplaceMetadata || {})) {
        if (!v || typeof v !== "object") continue;
        marketplaces[mp] = { externalId: v.externalId ?? null, status: v.status ?? null, pictureUrl: v.pictureUrl ?? null, price: v.price ?? null };
        if (!hero && v.pictureUrl && v.status === "LISTED") hero = v.pictureUrl;
        if (price == null && v.price != null) price = v.price;
      }
      out.push({
        niftyId: c.id,
        title: c.title,
        status: "LISTED",
        privateNotes: c.privateNotes ?? null,
        skus: Array.isArray(c.skus) ? c.skus : null,
        heroImage: hero,
        price,
        marketplaces,
      });
    }
    if (items.length === 0) {
      done = true;
      break;
    }
    if (opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs));
  }
  return { items: out, total, nextPage: page, done };
}

if (typeof module !== "undefined") module.exports = { niftyListedPages };
