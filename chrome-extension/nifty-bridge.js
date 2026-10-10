// Nifty bridge (Phase LIST-3): turn one approved FIA listing draft into a
// Nifty draft WITHOUT Nifty's "Generate" (no credits).
//
// Nifty's web app talks to its own tRPC API at api.nifty.ai/api/v1 using the
// signed-in browser session. This file runs inside the app.nifty.ai tab (MAIN
// world, injected by popup.js) and:
//   1. reads a TEMPLATE item (an existing listing of the same kind) for the
//      fixed per-marketplace settings: shipping, returns, payment, offers,
//      Mercari / Depop / Whatnot shipping, Poshmark size, venue categories
//   2. fills in our content: title, description, condition, prices, SKU,
//      private notes, photos, eBay category, eBay item specifics, eBay store
//      categories, and the SHIPPING WEIGHT (FIA's, when it has one): eBay and
//      Mercari package weight, Mercari's shipping label (first option for
//      that weight, as the First-Shipping Picker did), Depop's parcel size
//      and Whatnot's shipping profile
//   3. calls inventory.saveAsDraftV2 (the draft editor's "Save draft") — the
//      item lands in Nifty's Drafts — then re-reads it to confirm no
//      marketplace shows it as listed. Nothing is published.
//
//   NEVER use inventory.addItemV2: despite an `isDraft` field it is Nifty's
//   "Publish" and lists the item on every marketplace (learned Oct 8 2026,
//   when a test listed the Terminal Tower brochure everywhere).
//
// The whole thing is one function (`niftyBridgeSend`) so it can be injected
// with chrome.scripting.executeScript({ func }). Pure helpers live inside it.
// `api` can be passed for tests; in the page it defaults to fetch.

/* eslint-disable no-unused-vars */
async function niftyBridgeSend(draft, options) {
  const opts = Object.assign({ dryRun: false, api: null }, options || {});
  const BASE = "https://api.nifty.ai/api/v1/";
  const api = opts.api || {
    async get(proc, input) {
      const r = await fetch(BASE + proc + "?input=" + encodeURIComponent(JSON.stringify(input)), { credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(`${proc}: ${(j.error && j.error.message) || "HTTP " + r.status}`.slice(0, 600));
      return j.result ? j.result.data : j;
    },
    async post(proc, input) {
      // The ONLY write this bridge may make. inventory.addItemV2 is Nifty's
      // "Publish" (it lists on every marketplace) — never call it.
      if (proc !== "inventory.saveAsDraftV2") throw new Error("Refusing to call " + proc);
      const r = await fetch(BASE + proc, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(`${proc}: ${(j.error && j.error.message) || "HTTP " + r.status}`.slice(0, 1500));
      return j.result ? j.result.data : j;
    },
    uuid() {
      return crypto.randomUUID();
    },
  };

  const warnings = [];
  const norm = (s) =>
    String(s == null ? "" : s)
      .toLowerCase()
      .replace(/&amp;/g, "&")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  // Sections copied from the template: the fixed settings. Everything in
  // SPECIFIC / BRAND / COLOR / TAGS describes the template's own item and is
  // dropped (unless the marketplace requires it).
  const KEEP_SECTIONS = new Set(["SHIPPING", "PRICING", "SIZE", "SIZE_TYPE"]);

  const taxCache = new Map();
  async function taxonomy(marketplace, categoryId) {
    const key = marketplace + "|" + (categoryId || "");
    if (!taxCache.has(key)) {
      const input = { marketplace, sections: "ALL_SECTIONS", includeGlobal: true };
      if (categoryId) input.categoryId = categoryId;
      taxCache.set(key, api.get("taxonomy.getMarketplaceTaxonomy", input));
    }
    const t = await taxCache.get(key);
    return { attributes: (t && t.attributes) || [], dynamicProviders: (t && t.dynamicProviders) || [] };
  }

  function keepFixed(values, attrsById) {
    return (values || []).filter((v) => {
      const a = attrsById[v.id];
      if (!a) return false; // not valid for this category any more
      return a.required || KEEP_SECTIONS.has(a.section);
    });
  }

  // ── weight (FIA's weightOz) ─────────────────────────────────────────────
  const weightOz = Number(draft.weightOz) > 0 ? Number(draft.weightOz) : null;
  const lbOz = (t) => {
    const x = Math.ceil(t * 10) / 10;
    const lb = Math.floor(x / 16);
    return [lb, Math.round((x - lb * 16) * 10) / 10];
  };
  async function dynMembers(marketplace, attr, values) {
    if (!attr.dynamicProviderId) return attr.members || [];
    const dyn = await api.get("taxonomy.loadDynamicProvider", {
      marketplace,
      dynamicProviderId: attr.dynamicProviderId,
      dynamicProviderContext: { attributeValues: values },
      areAllDependenciesSatisfied: true,
    });
    const d = (dyn || []).find((x) => x.id === attr.id);
    return (d && d.members) || [];
  }
  const memberValue = (attr, mm) =>
    attr.dynamicProviderId
      ? { type: "taxonomy-enum-dynamically-loaded-value", id: mm.id, externalId: mm.externalId }
      : { type: "taxonomy-enum-member", id: mm.id, externalId: mm.externalId, name: mm.name };
  /** Upper bound (oz) of a size bucket name: "under_12oz", "8-11 oz", "1 lb", "1-2 lbs", "Media 4 lbs". */
  function bucketMaxOz(label) {
    const t = String(label || "").toLowerCase().replace(/_/g, " ");
    let m = t.match(/under\s*(\d+(?:\.\d+)?)\s*(oz|lbs?)/);
    if (m) return Number(m[1]) * (m[2] === "oz" ? 1 : 16) - 0.001;
    m = t.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(oz|lbs?)/);
    if (m) return m[3] === "oz" ? Number(m[2]) + 0.99 : Number(m[2]) * 16;
    m = t.match(/(\d+(?:\.\d+)?)\s*(oz|lbs?)/);
    if (m) return Number(m[1]) * (m[2] === "oz" ? 1 : 16);
    return null;
  }
  function pickBucket(members, oz, wantMedia) {
    const ok = members
      .map((mm) => ({ mm, max: bucketMaxOz(mm.name || mm.externalId), media: /media/i.test(mm.name || "") }))
      .filter((x) => x.max != null && x.media === !!wantMedia && x.max >= oz)
      .sort((a, b) => a.max - b.max);
    return ok.length ? ok[0].mm : null;
  }
  /** Put FIA's weight on one marketplace listing's SHIPPING values. */
  async function applyWeight(marketplace, values, tax) {
    if (!weightOz) return values;
    const byName = Object.fromEntries(tax.attributes.map((a) => [norm(a.name), a]));
    const [lb, oz] = lbOz(weightOz);
    const wAttr = byName["package weight"];
    if (wAttr) {
      const cur = values.find((v) => v.id === wAttr.id);
      if (cur && Array.isArray(cur.values) && cur.values.length >= 2) {
        const next = { ...cur, values: cur.values.map((x, i) => ({ ...x, value: i === 0 ? lb : i === 1 ? oz : x.value })) };
        values = values.map((v) => (v.id === wAttr.id ? next : v));
      } else {
        warnings.push(`${marketplace}: couldn't set the package weight (template has none); set ${lb} lb ${oz} oz in Nifty`);
      }
    }
    if (marketplace === "Mercari") {
      const label = byName["shipping label"];
      if (label) {
        try {
          const members = await dynMembers("Mercari", label, values);
          // The first option, as the First-Shipping Picker did — but a Media
          // Mail template (books) keeps a Media Mail label when one is offered.
          const cur = values.find((v) => v.id === label.id);
          const curId = cur && cur.values && cur.values[0] && cur.values[0].id;
          const curName = ((members.find((mm) => mm.id === curId) || {}).name) || "";
          const wasMedia = /media/i.test(curName) || /media/i.test(String(draft.shippingProfile || ""));
          const pick = (wasMedia && members.find((mm) => /media/i.test(mm.name || ""))) || members[0];
          if (pick) {
            values = values.filter((v) => v.id !== label.id);
            values.push({ type: "enum-attribute-values", id: label.id, values: [memberValue(label, pick)] });
          } else warnings.push("Mercari: no shipping label offered for this weight; pick one in Nifty");
        } catch (e) {
          warnings.push("Mercari: couldn't load shipping labels (" + String(e.message || e).slice(0, 80) + "); pick one in Nifty");
        }
      }
    }
    for (const [mkt, name] of [["Depop", "parcel size"], ["Whatnot", "shipping profile"]]) {
      if (marketplace !== mkt || !byName[name]) continue;
      const attr = byName[name];
      try {
        const members = await dynMembers(mkt, attr, values);
        const cur = values.find((v) => v.id === attr.id);
        const curId = cur && cur.values && cur.values[0] && cur.values[0].id;
        const curName = ((members.find((mm) => mm.id === curId) || {}).name) || "";
        const pick = pickBucket(members, weightOz, /media/i.test(curName)) || pickBucket(members, weightOz, false);
        if (pick) {
          values = values.filter((v) => v.id !== attr.id);
          values.push({ type: "enum-attribute-values", id: attr.id, values: [memberValue(attr, pick)] });
        } else warnings.push(`${mkt}: no ${name} fits ${weightOz} oz; check it in Nifty`);
      } catch (e) {
        warnings.push(`${mkt}: couldn't load ${name} options (${String(e.message || e).slice(0, 80)})`);
      }
    }
    return values;
  }
  if (!weightOz) warnings.push("No weight on this draft: Nifty keeps the template's package weight. Weigh it if it isn't flat paper.");

  // ── 1. template ──────────────────────────────────────────────────────────
  if (!draft || !draft.templateId) throw new Error("No Nifty template item for this draft");
  const tpl = await api.get("inventory.getInventoryItem", { inventoryItemId: draft.templateId, mode: "edit" });
  if (!tpl || !tpl.inventoryItem) throw new Error("Template item not found in Nifty: " + draft.templateId);

  // ── 2. eBay category → Nifty's id for it ─────────────────────────────────
  const tplEbay = (tpl.marketplaceListings || []).find((m) => m.marketplace === "eBay");
  let ebayCategory = tplEbay ? tplEbay.category : null;
  if (draft.ebayCategoryPath) {
    const parts = String(draft.ebayCategoryPath).split(/\s*(?:>|›|:)\s*/).filter(Boolean);
    const leaf = parts[parts.length - 1];
    const want = norm(parts.join(" "));
    const found = (await api.get("taxonomy.getCategories", { marketplace: "eBay", query: leaf })) || [];
    const hit = found.find((c) => c.isSelectable !== false && norm([...(c.namePath || []), c.name].join(" ")) === want);
    if (hit) ebayCategory = hit;
    else warnings.push(`eBay category "${draft.ebayCategoryPath}" not found in Nifty; kept the template's (${tplEbay ? [...tplEbay.category.namePath, tplEbay.category.name].join(" > ") : "none"})`);
  }

  // ── 3. eBay listing: fixed settings + our specifics + store categories ──
  const listings = [];
  for (const m of tpl.marketplaceListings || []) {
    const isEbay = m.marketplace === "eBay";
    const categoryId = isEbay && ebayCategory ? ebayCategory.id : m.category && m.category.id;
    const tax = await taxonomy(m.marketplace, categoryId);
    const byId = Object.fromEntries(tax.attributes.map((a) => [a.id, a]));
    let values = keepFixed(m.attributeValues, byId);

    if (isEbay) {
      const byName = Object.fromEntries(tax.attributes.map((a) => [norm(a.name), a]));
      // Our item specifics, matched to Nifty's eBay fields by name.
      for (const [name, raw] of Object.entries(draft.itemSpecifics || {})) {
        const a = byName[norm(name)];
        if (!a) {
          warnings.push(`eBay specific "${name}" isn't a field for this category; skipped`);
          continue;
        }
        if (a.section === "SHIPPING" || a.section === "PRICING" || a.section === "SELLER_COLLECTION") continue;
        const list = (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean).slice(0, a.maxValues || 30);
        const out = [];
        for (const v of list) {
          const member = (a.members || []).find((mm) => norm(mm.name) === norm(v));
          if (member) out.push({ type: "taxonomy-enum-member", id: member.id, externalId: member.externalId, name: member.name });
          else if (a.allowFreeSolo) out.push({ type: "taxonomy-enum-free-solo", name: v.slice(0, 65) });
          else warnings.push(`"${v}" isn't an allowed value for eBay "${a.name}"; skipped`);
        }
        if (out.length && a.type === "taxonomy-enum-attribute") {
          values = values.filter((x) => x.id !== a.id);
          values.push({ type: "enum-attribute-values", id: a.id, values: out });
        }
      }
      // eBay store categories (dynamic list in Nifty, keyed by eBay's id).
      const storeAttr = tax.attributes.find((a) => a.section === "SELLER_COLLECTION");
      if (storeAttr && (draft.storeCategoryIds || []).length) {
        let members = storeAttr.members || [];
        if (storeAttr.dynamicProviderId) {
          const dyn = await api.get("taxonomy.loadDynamicProvider", {
            marketplace: "eBay",
            dynamicProviderId: storeAttr.dynamicProviderId,
            dynamicProviderContext: { attributeValues: [] },
            areAllDependenciesSatisfied: true,
          });
          const dAttr = (dyn || []).find((x) => x.id === storeAttr.id);
          if (dAttr && dAttr.members) members = dAttr.members;
        }
        const picked = [];
        for (const sid of draft.storeCategoryIds.slice(0, storeAttr.maxValues || 2)) {
          const mm = members.find((x) => String(x.externalId) === String(sid));
          if (mm) picked.push({ type: "taxonomy-enum-dynamically-loaded-value", id: mm.id, externalId: mm.externalId });
          else warnings.push(`eBay store category ${sid} isn't in Nifty's list (re-sync store categories?)`);
        }
        values = values.filter((x) => x.id !== storeAttr.id);
        if (picked.length) values.push({ type: "enum-attribute-values", id: storeAttr.id, values: picked });
      }
    }
    // Required fields left empty. Many "required" fields only apply when
    // another setting is on (e.g. Mercari's floor price with smart pricing),
    // so only warn when the template itself had a value there.
    const tplHad = new Set((m.attributeValues || []).map((v) => v.id));
    for (const a of tax.attributes.filter((x) => x.required)) {
      if (!values.some((v) => v.id === a.id) && (tplHad.has(a.id) || isEbay && a.section !== "SHIPPING" && a.section !== "PRICING")) {
        warnings.push(`${m.marketplace} "${a.name}" is required and still empty`);
      }
    }

    let price = Number(draft.price);
    if (draft.venuePrices && draft.venuePrices[m.marketplace.toLowerCase()] != null) {
      price = Number(draft.venuePrices[m.marketplace.toLowerCase()]);
    }
    values = await applyWeight(m.marketplace, values, tax);
    listings.push({
      marketplace: m.marketplace,
      attributeValues: values,
      isValid: true,
      pictureIndices: (draft.photos || []).map((_, i) => i),
      price,
      category: categoryId,
    });
  }

  // ── 4. item level ────────────────────────────────────────────────────────
  const src = tpl.inventoryItem;
  const srcTax = await taxonomy(src.sourceMarketplace || (src.category && src.category.marketplace) || "Poshmark", src.category && src.category.id);
  const srcById = Object.fromEntries(srcTax.attributes.map((a) => [a.id, a]));
  const CONDITION = {
    new: "NEW",
    "like new": "LIKE_NEW",
    "new with imperfections": "NEW_WITH_IMPERFECTIONS",
    excellent: "EXCELLENT",
    used: "GOOD",
    "pre-owned - good": "GOOD",
    "pre-owned - fair": "FAIR",
    "for parts or not working": "FAIR",
  };
  const inventoryItem = {
    title: String(draft.title || "").slice(0, 80),
    description: String(draft.description || ""),
    condition: CONDITION[String(draft.condition || "").toLowerCase()] || "GOOD",
    quantity: Math.max(1, Number(draft.quantity) || 1),
    price: Number(draft.price),
    sourceMarketplace: src.sourceMarketplace,
    attributeValues: keepFixed(src.attributeValues, srcById),
    userLabels: [],
  };
  if (draft.conditionNote) inventoryItem.conditionDescription = String(draft.conditionNote).slice(0, 1000);
  if (draft.sku) inventoryItem.sku = String(draft.sku);
  if (draft.privateNotes) inventoryItem.privateNotes = String(draft.privateNotes);
  if (src.category && src.category.id) inventoryItem.category = src.category.id;
  if (!(inventoryItem.price > 0)) throw new Error("Draft has no price");

  // ── 5. photos: our public URLs as "external" pictures ────────────────────
  const pictures = (draft.photos || []).map((url) => ({ type: "external", id: api.uuid(), publicUrl: url }));
  if (!pictures.length) throw new Error("Draft has no photos");
  const media = { pictures, videos: [] };
  if (tpl.media && tpl.media.marketplace) media.marketplace = tpl.media.marketplace;

  const payload = {
    media,
    inventoryItem,
    marketplaceListings: listings,
    inventoryItemId: api.uuid(),
    isDraft: false,
    // Nifty's "Save draft" (the draft editor's own button). IN_PROGRESS =
    // not marked "Ready to list"; Todd reviews and publishes in Nifty.
    lifecycleStatus: opts.lifecycleStatus === "READY_TO_LIST" ? "READY_TO_LIST" : "IN_PROGRESS",
  };
  if (opts.dryRun) return { ok: true, dryRun: true, payload, warnings };

  const result = await api.post("inventory.saveAsDraftV2", payload);
  const niftyId = (result && (result.draftId || result.inventoryItemId)) || payload.inventoryItemId;

  // Check it really is a draft: no marketplace may show LISTED.
  let check = null;
  try {
    check = await api.get("inventory.getInventoryItem", { inventoryItemId: niftyId, mode: "edit" });
  } catch (e) {
    warnings.push("Couldn't re-read the new Nifty draft: " + e.message);
  }
  const listed = ((check && check.marketplaceListings) || []).filter((l) => l.status === "LISTED").map((l) => l.marketplace);
  if (listed.length) {
    return { ok: false, niftyId, warnings, error: "Nifty LISTED this item on " + listed.join(", ") + " — stop and check Nifty" };
  }
  return { ok: true, niftyId, warnings };
}

if (typeof module !== "undefined") module.exports = { niftyBridgeSend };
