// Popup logic for the Found in Alabama Nifty sync extension.
//
// Decides which "view" to render based on whether the API key is
// configured and whether the active tab is a Nifty inventory page.
// The sync flow uses chrome.scripting.executeScript in MAIN world to
// reach into the page's React state (impossible from a normal content
// script's isolated world), pulls one record per item row, and POSTs
// the batch to /api/admin/items/capture.

const DEFAULT_ENDPOINT = "https://www.foundinalabama.com";
const NIFTY_INVENTORY_PATTERN = /^https:\/\/app\.nifty\.ai\/inventory/;

const $ = (sel) => document.querySelector(sel);

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const { apiKey, endpoint, lastSync } = await chrome.storage.local.get([
    "apiKey",
    "endpoint",
    "lastSync",
  ]);
  if (!apiKey) {
    renderSettings({ endpoint, apiKey });
    return;
  }
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.url || !NIFTY_INVENTORY_PATTERN.test(tab.url)) {
    renderWrongTab({ lastSync });
    return;
  }
  renderReadyToSync({ tab, endpoint, lastSync });
}

// ─── View renderers ──────────────────────────────────────────────────────────

function renderSettings({ apiKey = "", endpoint = "" }) {
  $("#main").innerHTML = `
    <h2>Settings</h2>
    <p class="muted">Paste your API key from <strong>foundinalabama.com/admin/api-keys</strong>. The key looks like <code>fia_…</code>.</p>
    <label for="api-key">API key</label>
    <textarea id="api-key" rows="2" placeholder="fia_...">${escapeHtml(apiKey)}</textarea>
    <label for="endpoint">Endpoint (leave blank for production)</label>
    <input id="endpoint" type="url" placeholder="${DEFAULT_ENDPOINT}" value="${escapeHtml(endpoint)}" />
    <div class="row">
      <button class="primary" id="save">Save</button>
      <div class="spacer"></div>
      <button class="secondary tiny" id="back-from-settings">Cancel</button>
    </div>
    <p id="save-msg" class="muted" style="margin-top:8px"></p>
  `;
  $("#save").addEventListener("click", async () => {
    const apiKey = $("#api-key").value.trim();
    const endpoint = $("#endpoint").value.trim();
    if (!apiKey.startsWith("fia_")) {
      $("#save-msg").innerHTML = `<span style="color:#7f1d1d">Key should start with "fia_". Double-check what you pasted.</span>`;
      return;
    }
    await chrome.storage.local.set({
      apiKey,
      endpoint: endpoint || DEFAULT_ENDPOINT,
    });
    $("#save-msg").innerHTML = "Saved.";
    setTimeout(init, 400);
  });
  const back = $("#back-from-settings");
  if (apiKey) {
    back.addEventListener("click", init);
  } else {
    back.style.display = "none";
  }
  setFooter(false);
}

function renderWrongTab({ lastSync }) {
  $("#main").innerHTML = `
    <h2>Not a Nifty inventory page</h2>
    <p class="muted">Open <a href="https://app.nifty.ai/inventory" target="_blank">app.nifty.ai/inventory</a> (or any of its filtered views) and click the extension icon again.</p>
    ${
      lastSync
        ? `<p class="muted" style="margin-top:8px">Last sync: ${escapeHtml(formatTime(lastSync.at))} · ${lastSync.upserted} captured, ${lastSync.linkedToHaul} linked.</p>`
        : ""
    }
  `;
  setFooter(true);
}

function renderReadyToSync({ tab, lastSync }) {
  const filterMode = filterModeFromUrl(tab.url);
  $("#main").innerHTML = `
    <h2>Ready to sync</h2>
    <p>You're viewing the <span class="badge ${filterMode === "sold" ? "sold" : "listed"}">${filterMode}</span> filter.</p>
    <p class="muted">Click below to scan every item on this page, capture title + marketplace links + private notes, and send the batch to Found in Alabama.</p>
    <div class="row" style="margin-top:12px">
      <button class="primary" id="sync">Sync this page</button>
      <div class="spacer"></div>
    </div>
    <div id="result"></div>
    ${
      lastSync
        ? `<p class="muted" style="margin-top:12px">Last sync: ${escapeHtml(formatTime(lastSync.at))} · ${lastSync.upserted} captured, ${lastSync.linkedToHaul} linked, ${lastSync.markedSold} sold.</p>`
        : ""
    }
  `;
  $("#sync").addEventListener("click", () => doSync(tab));
  setFooter(true);
}

function renderError(msg) {
  $("#result").innerHTML = `<div class="alert error">${escapeHtml(msg)}</div>`;
}

function renderResult(result) {
  const errs =
    result.errors && result.errors.length
      ? `<div class="alert warn" style="margin-top:8px">${result.errors.length} item(s) failed. First error: ${escapeHtml(result.errors[0].error)}</div>`
      : "";
  $("#result").innerHTML = `
    <div class="alert success" style="margin-top:12px">
      Synced ${result.upserted} item${result.upserted === 1 ? "" : "s"}.
      ${result.linkedToHaul} linked to hauls.
      ${result.markedSold} marked sold.
    </div>
    <div class="stats">
      <div class="stat"><div class="num">${result.upserted}</div><div class="label">Captured</div></div>
      <div class="stat"><div class="num">${result.linkedToHaul}</div><div class="label">Linked</div></div>
      <div class="stat"><div class="num">${result.markedSold}</div><div class="label">Sold</div></div>
    </div>
    ${errs}
  `;
}

// ─── Sync flow ───────────────────────────────────────────────────────────────

async function doSync(tab) {
  const btn = $("#sync");
  btn.disabled = true;
  btn.textContent = "Scanning page…";
  $("#result").innerHTML = "";

  let scrapeResult;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: scrapeNiftyInventoryPage,
    });
    scrapeResult = res?.result;
  } catch (err) {
    renderError(`Could not run scraper: ${err.message}`);
    resetButton(btn);
    return;
  }

  if (!scrapeResult || !Array.isArray(scrapeResult.items) || scrapeResult.items.length === 0) {
    renderError(
      "Found no items on the page. Make sure the inventory grid has finished loading (try scrolling once and re-clicking)."
    );
    resetButton(btn);
    return;
  }

  btn.textContent = `Sending ${scrapeResult.items.length} item${scrapeResult.items.length === 1 ? "" : "s"}…`;

  const { apiKey, endpoint } = await chrome.storage.local.get(["apiKey", "endpoint"]);
  const url = (endpoint || DEFAULT_ENDPOINT) + "/api/admin/items/capture";

  let result;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(scrapeResult),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    result = await res.json();
  } catch (err) {
    renderError(err.message ?? "Network error");
    resetButton(btn);
    return;
  }

  await chrome.storage.local.set({
    lastSync: {
      at: new Date().toISOString(),
      upserted: result.upserted,
      linkedToHaul: result.linkedToHaul,
      markedSold: result.markedSold,
    },
  });

  renderResult(result);
  resetButton(btn);
}

function resetButton(btn) {
  btn.disabled = false;
  btn.textContent = "Sync this page";
}

// ─── Scraper (runs in MAIN world) ────────────────────────────────────────────
//
// IMPORTANT: this function is serialized and injected into the page's
// main JS world via chrome.scripting.executeScript. It can't close over
// any popup-scope variables; it must be self-contained.

function scrapeNiftyInventoryPage() {
  const filterParam =
    new URL(location.href).searchParams.get("filter") || "listed";
  const filterMode = filterParam === "sold" ? "sold" : "listed";

  function findFiber(el) {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    return key ? el[key] : null;
  }

  // Find each row's item data by walking up the React fiber tree.
  // Returns one entry per distinct id (dedup by Nifty id).
  const byId = new Map();
  const rowEls = document.querySelectorAll("tr.MuiTableRow-root");

  for (const tr of rowEls) {
    let f = findFiber(tr);
    let depth = 0;
    while (f && depth < 12) {
      const props = f.memoizedProps;
      if (props && typeof props === "object") {
        const candidates = [
          props.row?.row,
          props.row,
          props.item,
          props.listing,
          props,
        ];
        for (const c of candidates) {
          if (
            c &&
            typeof c === "object" &&
            typeof c.id === "string" &&
            typeof c.title === "string" &&
            c.marketplaceMetadata
          ) {
            if (!byId.has(c.id)) {
              const md = c.marketplaceMetadata || {};
              const marketplaces = {};
              for (const mp of Object.keys(md)) {
                const v = md[mp];
                if (v && typeof v === "object") {
                  marketplaces[mp] = {
                    externalId: v.externalId ?? null,
                    status: v.status ?? null,
                    pictureUrl: v.pictureUrl ?? null,
                    price: v.price ?? null,
                  };
                }
              }
              byId.set(c.id, {
                niftyId: c.id,
                title: c.title,
                status: c.status ?? null,
                privateNotes: c.privateNotes ?? null,
                soldAt: c.soldAt ?? null,
                skus: Array.isArray(c.skus) ? c.skus : null,
                heroImage: pickHeroImage(marketplaces),
                price: pickPrice(marketplaces),
                marketplaces,
              });
            }
            break;
          }
        }
      }
      f = f.return;
      depth++;
    }
  }

  function pickHeroImage(marketplaces) {
    for (const v of Object.values(marketplaces)) {
      if (v && v.pictureUrl) return v.pictureUrl;
    }
    return null;
  }
  function pickPrice(marketplaces) {
    for (const v of Object.values(marketplaces)) {
      if (v && v.price != null) return v.price;
    }
    return null;
  }

  return {
    filterMode,
    items: Array.from(byId.values()),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filterModeFromUrl(url) {
  try {
    const p = new URL(url).searchParams.get("filter");
    return p === "sold" ? "sold" : p === "drafts" ? "drafts" : "listed";
  } catch {
    return "listed";
  }
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function setFooter(showSettings) {
  $("#footer").innerHTML = showSettings
    ? `<a id="open-settings">Settings</a>`
    : "";
  if (showSettings) {
    $("#open-settings").addEventListener("click", async () => {
      const { apiKey, endpoint } = await chrome.storage.local.get([
        "apiKey",
        "endpoint",
      ]);
      renderSettings({ apiKey, endpoint });
    });
  }
}
