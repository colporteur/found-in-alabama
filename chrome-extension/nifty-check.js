// Delist check (Phase 2 readiness): read Nifty's recently SOLD items, newest
// sale first, with every marketplace's status for each (SOLD on the venue
// that sold it, DELISTED where Nifty took it down, LISTED where it's still
// up). popup.js posts them to FIA's capture endpoint, which records the
// per-venue status; FIA's outcome checker then scores its shadow delist
// plans against it and counts any sale FIA never saw.
//
// READ-ONLY: one GET procedure (inventory.getInventory). Nothing in Nifty
// changes. Runs in the app.nifty.ai tab (MAIN world) like nifty-bridge.js.

/* eslint-disable no-unused-vars */
async function niftyRecentSold(sinceIso, options) {
  const opts = Object.assign({ maxPages: 40, pauseMs: 700, get: null }, options || {});
  const since = Date.parse(sinceIso);
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
  let pages = 0;
  let reachedSince = false;
  for (let page = 0; page < opts.maxPages; page++) {
    const data = await get({
      query: "",
      page,
      filter: "sold",
      search: "all_fields",
      sort: "sale_detected_at",
      sortOrder: "desc",
      warning: "all",
      marketplaces: { include: [], exclude: [] },
      labels: { include: [], exclude: [] },
    });
    pages++;
    const items = (data && data.items) || [];
    for (const c of items) {
      const soldMs = c.soldAt ? Date.parse(c.soldAt) : NaN;
      if (Number.isFinite(soldMs) && soldMs < since) {
        reachedSince = true;
        break;
      }
      const marketplaces = {};
      let hero = null;
      let price = null;
      for (const [mp, v] of Object.entries(c.marketplaceMetadata || {})) {
        if (!v || typeof v !== "object") continue;
        marketplaces[mp] = { externalId: v.externalId ?? null, status: v.status ?? null, pictureUrl: v.pictureUrl ?? null, price: v.price ?? null };
        if (!hero && v.pictureUrl && (v.status === "SOLD" || v.status === "LISTED")) hero = v.pictureUrl;
        if (price == null && v.price != null) price = v.price;
      }
      out.push({
        niftyId: c.id,
        title: c.title,
        status: c.status ?? null,
        privateNotes: c.privateNotes ?? null,
        soldAt: c.soldAt ?? null,
        skus: Array.isArray(c.skus) ? c.skus : null,
        heroImage: hero,
        price,
        marketplaces,
      });
    }
    if (reachedSince || items.length === 0) break;
    if (opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs));
  }
  return { items: out, pages, complete: reachedSince };
}

if (typeof module !== "undefined") module.exports = { niftyRecentSold };
