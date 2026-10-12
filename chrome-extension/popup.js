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
const NIFTY_APP_PATTERN = /^https:\/\/app\.nifty\.ai\//;

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
  if (tab?.url && /^https:\/\/www\.mercari\.com\//.test(tab.url)) {
    $("#main").innerHTML = `<div id="mercari-delist"></div>`;
    setFooter(true);
    renderMercariDelists(tab);
    return;
  }
  if (!tab?.url || !NIFTY_APP_PATTERN.test(tab.url)) {
    renderWrongTab({ lastSync });
    return;
  }
  if (!NIFTY_INVENTORY_PATTERN.test(tab.url)) {
    // Any other Nifty page: only the "Send approved to Nifty" section.
    $("#main").innerHTML = `<div id="nifty-send"></div>`;
    setFooter(true);
  } else {
    renderReadyToSync({ tab, endpoint, lastSync });
  }
  renderNiftySend(tab);
  renderNiftyCheck(tab);
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
    <h2>Not a Nifty page</h2>
    <p class="muted">Open <a href="https://app.nifty.ai/inventory" target="_blank">app.nifty.ai/inventory</a> (or any of its filtered views) and click the extension icon again. Any Nifty page works for sending approved listings.</p>
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
    <p class="muted">Capture this page, or walk every page of this filter automatically and capture all of them.</p>
    <div class="row" style="margin-top:12px">
      <button class="primary" id="sync-all">Sync ALL pages</button>
      <div class="spacer"></div>
      <button class="secondary tiny" id="sync">This page only</button>
    </div>
    <div id="progress" class="muted" style="margin-top:10px"></div>
    <div id="result"></div>
    ${
      lastSync
        ? `<p class="muted" style="margin-top:12px">Last sync: ${escapeHtml(formatTime(lastSync.at))} · ${lastSync.upserted} captured, ${lastSync.linkedToHaul} linked, ${lastSync.markedSold} sold.</p>`
        : ""
    }
    <div id="nifty-send"></div>
  `;
  $("#sync").addEventListener("click", () => doSync(tab));
  $("#sync-all").addEventListener("click", () => doSyncAll(tab));
  setFooter(true);
}

// ─── Send approved listing drafts to Nifty (Phase LIST-3) ───────────────────
//
// Approved drafts from foundinalabama.com/admin/listings are created in Nifty
// as DRAFTS (Nifty's own "Save draft" request) from this signed-in tab, one
// at a time. No "Generate", no credits, nothing published: Todd reviews each
// draft in Nifty and publishes it there. nifty-bridge.js does the work.

const NIFTY_SEND_PAUSE_MS = 2500;

async function fiaFetch(path, init = {}) {
  const { apiKey, endpoint } = await chrome.storage.local.get(["apiKey", "endpoint"]);
  const res = await fetch((endpoint || DEFAULT_ENDPOINT) + path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

async function renderNiftySend(tab) {
  const box = $("#nifty-send");
  if (!box) return;
  box.innerHTML = `<hr style="margin:14px 0;border:none;border-top:1px solid rgba(0,0,0,.1)"><h2>Approved listings</h2><p class="muted">Checking foundinalabama.com…</p>`;
  let items;
  try {
    items = (await fiaFetch("/api/admin/listings/nifty-queue")).items || [];
  } catch (err) {
    box.innerHTML = `<hr style="margin:14px 0;border:none;border-top:1px solid rgba(0,0,0,.1)"><h2>Approved listings</h2><div class="alert error">${escapeHtml(err.message)}</div>`;
    return;
  }
  box.innerHTML = `
    <hr style="margin:14px 0;border:none;border-top:1px solid rgba(0,0,0,.1)">
    <h2>Approved listings</h2>
    ${
      items.length
        ? `<p>${items.length} approved draft${items.length === 1 ? "" : "s"} waiting. They go into Nifty as <strong>drafts</strong> — nothing is published.</p>
           <label style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:13px"><input type="checkbox" id="nifty-ready"> Mark them "Ready to list" in Nifty</label>
           <div class="row" style="margin-top:8px"><button class="primary" id="nifty-send-btn">Send approved to Nifty</button></div>`
        : `<p class="muted">No approved drafts waiting. Approve drafts at foundinalabama.com/admin/listings.</p>`
    }
    <div id="nifty-progress" style="margin-top:8px;font-size:13px;font-weight:600"></div>
    <div id="nifty-log" class="muted" style="margin-top:6px;font-size:12px;max-height:220px;overflow-y:auto"></div>`;
  const btn = $("#nifty-send-btn");
  const ready = $("#nifty-ready");
  if (ready) {
    // Remembered; on unless Todd turns it off.
    const { niftyReadyToList } = await chrome.storage.local.get(["niftyReadyToList"]);
    ready.checked = niftyReadyToList !== false;
    ready.addEventListener("change", () => chrome.storage.local.set({ niftyReadyToList: ready.checked }));
  }
  if (btn) btn.addEventListener("click", () => doSendToNifty(tab, items, { lifecycleStatus: ready && ready.checked ? "READY_TO_LIST" : "IN_PROGRESS" }));
}

async function doSendToNifty(tab, items, sendOpts = {}) {
  const btn = $("#nifty-send-btn");
  btn.disabled = true;
  const log = $("#nifty-log");
  const line = (html) => {
    log.insertAdjacentHTML("beforeend", `<div>${html}</div>`);
    log.scrollTop = log.scrollHeight;
  };
  let sent = 0;
  let failed = 0;
  const progress = $("#nifty-progress");
  const showProgress = (doneText) => {
    const n = sent + failed;
    const pct = items.length ? Math.round((n / items.length) * 100) : 100;
    progress.innerHTML =
      `<div style="height:6px;background:rgba(0,0,0,.1);border-radius:3px;overflow:hidden;margin-bottom:4px"><div style="height:6px;width:${pct}%;background:${failed ? "#b45309" : "#166534"}"></div></div>` +
      (doneText || `${n} of ${items.length} processed · ${sent} in Nifty${failed ? ` · <span style="color:#7f1d1d">${failed} failed</span>` : ""}`);
  };
  showProgress();
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["nifty-bridge.js"] });
  } catch (err) {
    line(`<span style="color:#7f1d1d">Couldn't load the bridge on this page: ${escapeHtml(err.message)}</span>`);
    btn.disabled = false;
    return;
  }
  for (const [i, item] of items.entries()) {
    btn.textContent = `Sending ${i + 1} of ${items.length}…`;
    let out;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: async (draft, o) => {
          try {
            // Still a draft either way: READY_TO_LIST is only Nifty's checkbox.
            return await window.niftyBridgeSend(draft, { lifecycleStatus: o.lifecycleStatus });
          } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
          }
        },
        args: [item, sendOpts],
      });
      out = res?.result || { ok: false, error: "No result from the page" };
    } catch (err) {
      out = { ok: false, error: err.message };
    }
    try {
      await fiaFetch(`/api/admin/listings/${item.draftId}/nifty`, {
        method: "POST",
        body: JSON.stringify(out.ok ? { niftyId: out.niftyId, warnings: out.warnings } : { error: out.error, warnings: out.warnings }),
      });
    } catch (err) {
      out.reportError = err.message;
    }
    const title = escapeHtml(item.title.slice(0, 60));
    if (out.ok) {
      sent++;
      const w = (out.warnings || []).length;
      line(`✓ <a href="https://app.nifty.ai/inventory/edit/${out.niftyId}" target="_blank">${title}</a>${w ? ` <span title="${escapeHtml(out.warnings.join("\n"))}">(${w} note${w === 1 ? "" : "s"})</span>` : ""}`);
    } else {
      failed++;
      line(`<span style="color:#7f1d1d">✗ ${title}: ${escapeHtml(out.error || "failed")}</span>`);
      if (/LISTED/.test(out.error || "")) {
        line(`<strong style="color:#7f1d1d">Stopped: Nifty listed an item instead of saving a draft. Check Nifty.</strong>`);
        break;
      }
    }
    if (out.reportError) line(`<span style="color:#78350f">Couldn't tell foundinalabama.com: ${escapeHtml(out.reportError)}</span>`);
    showProgress();
    if (i < items.length - 1) await sleep(NIFTY_SEND_PAUSE_MS);
  }
  const stoppedEarly = sent + failed < items.length;
  btn.textContent = `Done: ${sent} in Nifty${failed ? `, ${failed} failed` : ""}`;
  showProgress(
    `${stoppedEarly ? "⚠ Stopped" : "✓ Finished"}: ${sent} of ${items.length} in Nifty${failed ? ` · <span style="color:#7f1d1d">${failed} failed</span>` : ""}${
      stoppedEarly ? ` · ${items.length - sent - failed} not sent` : ""
    }`
  );
}

// ─── Check sales & delists (Phase 2 readiness) ──────────────────────────────
//
// Reads Nifty's recently sold items (read-only, nifty-check.js) and sends
// them to FIA, which scores its shadow delist plans against what Nifty did
// on each venue and spots any sale FIA missed. Nothing in Nifty changes.

async function renderNiftyCheck(tab) {
  const main = $("#main");
  if (!main) return;
  main.insertAdjacentHTML("beforeend", `<div id="nifty-check"></div>`);
  const box = $("#nifty-check");
  const hr = `<hr style="margin:14px 0;border:none;border-top:1px solid rgba(0,0,0,.1)">`;
  let info;
  try {
    info = await fiaFetch("/api/admin/sales/nifty-check");
  } catch (err) {
    box.innerHTML = `${hr}<h2>Sales &amp; delists</h2><div class="alert error">${escapeHtml(err.message)}</div>`;
    return;
  }
  box.innerHTML = `${hr}
    <h2>Sales &amp; delists</h2>
    <p class="muted">Reads Nifty's sales since ${escapeHtml(formatTime(info.since))} (read-only) so FIA can check its delist plans${
      info.openLegs ? ` — <strong>${info.openLegs}</strong> waiting` : ""
    }.${info.lastCheck ? ` Last check: ${escapeHtml(formatTime(info.lastCheck))}.` : ""}</p>
    <div class="row" style="margin-top:8px"><button class="primary" id="nifty-check-btn">Check sales &amp; delists</button></div>
    <div id="nifty-check-log" class="muted" style="margin-top:8px;font-size:12px"></div>`;
  $("#nifty-check-btn").addEventListener("click", () => doNiftyCheck(tab, info.since));
  renderListedSweep(tab, box);
}

// ─── Full inventory check (readiness test 1, "listings known") ──────────────
//
// Reads EVERY item in Nifty's Listed view (read-only, nifty-listed.js), 4
// pages (100 items) at a time, and sends each chunk to FIA's capture
// endpoint, so FIA knows where each item is live on Mercari, Poshmark, Depop
// and Whatnot. About 12,000 items ≈ 5–8 minutes. Nothing in Nifty changes.

const SWEEP_PAGES_PER_CALL = 4;

async function renderListedSweep(tab, box) {
  let last = null;
  try {
    last = (await fiaFetch("/api/admin/items/listed-sweep")).last;
  } catch {
    /* older FIA without the endpoint: still offer the button */
  }
  box.insertAdjacentHTML(
    "beforeend",
    `<p class="muted" style="margin-top:12px">Full inventory check: reads every Listed item (read-only) so FIA knows what is live on each venue. Takes several minutes; keep this popup open.${
      last ? ` Last run: ${escapeHtml(formatTime(last.finishedAt))}, ${last.seen} items${last.complete ? "" : " (stopped early)"}.` : " Never run."
    }</p>
    <div class="row" style="margin-top:6px"><button id="sweep-btn">Full inventory check</button> <a id="sweep-stop" style="display:none;margin-left:8px">Stop</a></div>
    <div id="sweep-log" class="muted" style="margin-top:6px;font-size:12px"></div>`
  );
  $("#sweep-btn").addEventListener("click", () => doListedSweep(tab));
}

async function doListedSweep(tab) {
  const btn = $("#sweep-btn");
  const stop = $("#sweep-stop");
  const log = $("#sweep-log");
  let stopped = false;
  stop.style.display = "inline";
  stop.onclick = () => {
    stopped = true;
    stop.textContent = "Stopping…";
  };
  btn.disabled = true;
  log.textContent = "";
  const startedAt = new Date().toISOString();
  let page = 0;
  let seen = 0;
  let total = null;
  let complete = false;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["nifty-listed.js"] });
    while (!stopped) {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: async (start, count) => {
          try {
            return await window.niftyListedPages(start, count, {});
          } catch (e) {
            return { error: String((e && e.message) || e) };
          }
        },
        args: [page, SWEEP_PAGES_PER_CALL],
      });
      const r = res?.result || { error: "No result from the page" };
      if (r.error) throw new Error(r.error);
      if (r.total != null) total = r.total;
      if (r.items.length) {
        await fiaFetch("/api/admin/items/capture", { method: "POST", body: JSON.stringify({ filterMode: "listed", items: r.items }) });
        seen += r.items.length;
      }
      page = r.nextPage;
      btn.textContent = `Read ${seen}${total ? ` of ${total}` : ""}…`;
      if (r.done) {
        complete = true;
        break;
      }
    }
    const done = await fiaFetch("/api/admin/items/listed-sweep", {
      method: "POST",
      body: JSON.stringify({ startedAt, seen, total, complete }),
    });
    const v = done.sweep?.venues || {};
    const line = Object.entries(v).map(([k, c]) => `${k} ${c.live} live${c.unknown ? `, ${c.unknown} unknown` : ""}`).join(" · ");
    log.innerHTML = `${complete ? "Done" : "Stopped"}: ${seen} Listed items read.` +
      (done.sweep?.endedUnseen ? ` ${done.sweep.endedUnseen} listings Nifty no longer shows marked ended.` : "") +
      (complete ? "" : " Nothing was marked ended because the run didn't finish.") +
      `<br>${escapeHtml(line)}`;
    btn.textContent = complete ? "Done" : "Full inventory check";
    btn.disabled = complete;
  } catch (err) {
    log.innerHTML = `<span style="color:#7f1d1d">${escapeHtml(err.message)}</span> Read ${seen} before stopping; run it again.`;
    btn.textContent = "Full inventory check";
    btn.disabled = false;
  }
  stop.style.display = "none";
}

async function doNiftyCheck(tab, since) {
  const btn = $("#nifty-check-btn");
  const log = $("#nifty-check-log");
  btn.disabled = true;
  btn.textContent = "Reading Nifty…";
  log.textContent = "";
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["nifty-check.js"] });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (s) => {
        try {
          return await window.niftyRecentSold(s, {});
        } catch (e) {
          return { error: String((e && e.message) || e) };
        }
      },
      args: [since],
    });
    const r = res?.result || { error: "No result from the page" };
    if (r.error) throw new Error(r.error);
    btn.textContent = `Sending ${r.items.length} sales to FIA…`;
    for (let i = 0; i < r.items.length; i += 100) {
      await fiaFetch("/api/admin/items/capture", {
        method: "POST",
        body: JSON.stringify({ filterMode: "sold", items: r.items.slice(i, i + 100) }),
      });
    }
    const done = await fiaFetch("/api/admin/sales/nifty-check", {
      method: "POST",
      body: JSON.stringify({ since, items: r.items.length, pages: r.pages, complete: r.complete }),
    });
    const o = done.outcomes || {};
    log.innerHTML = `Checked ${r.items.length} Nifty sales. Delists confirmed: ${(o.niftyDone ?? 0) + (o.ebayDone ?? 0) + (o.hipDone ?? 0)}, still up: ${o.stillLive ?? 0}.` +
      (r.complete ? "" : ` <span style="color:#92400e">Stopped after ${r.pages} pages before reaching ${escapeHtml(formatTime(since))}; run it again.</span>`) +
      ` See foundinalabama.com/admin/sales/readiness.`;
    btn.textContent = "Done";
  } catch (err) {
    log.innerHTML = `<span style="color:#7f1d1d">${escapeHtml(err.message)}</span>`;
    btn.textContent = "Check sales & delists";
    btn.disabled = false;
  }
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
  btn.textContent = "This page only";
}

// ─── Bulk sync: walk every page of the current filter ────────────────────────
//
// Loop: scrape current page → POST → if there's a next page, click it,
// wait for the grid to swap in new rows, pace, repeat. Gentle pacing
// keeps it human-ish across ~240 pages.

const PAGE_PACING_MS = 1800; // pause between pages
const PAGE_CHANGE_TIMEOUT_MS = 12000; // max wait for a page to re-render

async function doSyncAll(tab) {
  const allBtn = $("#sync-all");
  const pageBtn = $("#sync");
  allBtn.disabled = true;
  pageBtn.disabled = true;
  $("#result").innerHTML = "";

  const { apiKey, endpoint } = await chrome.storage.local.get([
    "apiKey",
    "endpoint",
  ]);
  const url = (endpoint || DEFAULT_ENDPOINT) + "/api/admin/items/capture";

  const totals = { pages: 0, upserted: 0, linkedToHaul: 0, markedSold: 0, errors: 0 };
  let cancelled = false;
  const onCancel = () => {
    cancelled = true;
  };

  function setProgress(msg) {
    $("#progress").innerHTML = `${escapeHtml(msg)} <a id="cancel-all" style="margin-left:8px">Stop</a>`;
    const c = document.getElementById("cancel-all");
    if (c) c.addEventListener("click", onCancel);
  }

  try {
    // Was capped at 400 pages (25 items each = 10,000 items), which stopped short of
    // the full Listed inventory. Now walks until Nifty reports no next page;
    // 2,000 pages is only a runaway guard.
    for (let page = 1; page <= 2000; page++) {
      if (cancelled) break;

      // 1. Scrape the current page.
      let scrape;
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: scrapeNiftyInventoryPage,
        });
        scrape = res?.result;
      } catch (err) {
        renderError(`Scraper failed on page ${page}: ${err.message}`);
        break;
      }

      const items = scrape?.items ?? [];
      const pageInfo = scrape?.pageInfo ?? {};
      setProgress(
        `Page ${page}${pageInfo.label ? " · " + pageInfo.label : ""} — ${items.length} items… (${totals.upserted} captured so far)`
      );

      // 2. POST this page's items.
      if (items.length > 0) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ filterMode: scrape.filterMode, items }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `HTTP ${res.status}`);
          }
          const r = await res.json();
          totals.pages += 1;
          totals.upserted += r.upserted ?? 0;
          totals.linkedToHaul += r.linkedToHaul ?? 0;
          totals.markedSold += r.markedSold ?? 0;
          totals.errors += (r.errors?.length ?? 0);
        } catch (err) {
          renderError(`Upload failed on page ${page}: ${err.message}. Captured ${totals.upserted} before stopping.`);
          break;
        }
      }

      // 3. Advance to the next page, or finish.
      if (!pageInfo.hasNext) {
        break;
      }
      const prevFirstId = pageInfo.firstId ?? null;
      let clicked;
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: clickNextNiftyPage,
        });
        clicked = res?.result;
      } catch (err) {
        renderError(`Could not click next page after page ${page}: ${err.message}`);
        break;
      }
      if (!clicked?.clicked) break;

      // 4. Wait for the grid to actually swap to the next page.
      const changed = await waitForPageChange(tab, prevFirstId);
      if (!changed) {
        renderError(`Page ${page + 1} didn't load in time. Captured ${totals.upserted} items. Re-run to continue.`);
        break;
      }

      // 5. Gentle pacing.
      await sleep(PAGE_PACING_MS);
    }
  } finally {
    await chrome.storage.local.set({
      lastSync: {
        at: new Date().toISOString(),
        upserted: totals.upserted,
        linkedToHaul: totals.linkedToHaul,
        markedSold: totals.markedSold,
      },
    });
    $("#progress").innerHTML = "";
    renderResult({
      upserted: totals.upserted,
      linkedToHaul: totals.linkedToHaul,
      markedSold: totals.markedSold,
      errors: totals.errors ? [{ error: `${totals.errors} item(s) had issues` }] : [],
    });
    const note = document.createElement("p");
    note.className = "muted";
    note.style.marginTop = "8px";
    note.textContent = `${cancelled ? "Stopped" : "Finished"} after ${totals.pages} page(s).`;
    $("#result").appendChild(note);
    allBtn.disabled = false;
    pageBtn.disabled = false;
  }
}

/** Poll the page until the first row id differs from prevFirstId. */
async function waitForPageChange(tab, prevFirstId) {
  const deadline = Date.now() + PAGE_CHANGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(400);
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: scrapeNiftyInventoryPage,
      });
      const firstId = res?.result?.pageInfo?.firstId ?? null;
      if (firstId && firstId !== prevFirstId) return true;
    } catch {
      // keep polling
    }
  }
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    // Prefer the marketplace that has status SOLD or LISTED (the one
    // that actually transacted or is currently live) — its pictureUrl is
    // most likely to be a real CDN URL. Skip DELISTED entries first.
    const entries = Object.values(marketplaces);
    for (const v of entries) {
      if (v && v.pictureUrl && (v.status === "SOLD" || v.status === "LISTED")) {
        return v.pictureUrl;
      }
    }
    // Fall back to any non-null pictureUrl (DELISTED platforms sometimes
    // still cache a thumbnail).
    for (const v of entries) {
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

  // Pagination signature for Nifty's custom pager: a 3-button group
  //   [‹ prev] [ "N of M" ] [next ›]
  // The arrow buttons have no aria-label/title/text, so we anchor on the
  // middle "N of M" indicator button and read its siblings. Returns the
  // "Viewing x-y of z" label, whether a next page exists, and the first
  // DATA row's id (so the popup can tell when the page actually changed).
  function readPageInfo() {
    let label = null;
    const viewing = Array.from(
      document.querySelectorAll("p, span, div")
    ).find(
      (e) => /Viewing\s+\d+/.test(e.textContent || "") && e.children.length === 0
    );
    if (viewing) label = viewing.textContent.trim();

    const indicator = Array.from(document.querySelectorAll("button")).find((b) =>
      /^\s*\d+\s+of\s+\d+\s*$/.test((b.textContent || "").trim())
    );
    let hasNext = false;
    if (indicator) {
      if (!label) label = indicator.textContent.trim();
      const m = indicator.textContent.trim().match(/^(\d+)\s+of\s+(\d+)$/);
      const sibs = Array.from(indicator.parentElement.querySelectorAll("button"));
      const idx = sibs.indexOf(indicator);
      const next = sibs[idx + 1] || null;
      const nextEnabled =
        !!next &&
        !next.disabled &&
        next.getAttribute("aria-disabled") !== "true";
      hasNext = m
        ? nextEnabled && parseInt(m[1], 10) < parseInt(m[2], 10)
        : nextEnabled;
    }

    // First data row's id (skip header / id-less rows).
    let firstId = null;
    for (const tr of document.querySelectorAll("tr.MuiTableRow-root")) {
      let f = findFiber(tr);
      let d = 0;
      while (f && d < 12) {
        const p = f.memoizedProps;
        const c = p?.row?.row ?? p?.row ?? p?.item ?? p?.listing;
        if (c && typeof c.id === "string") {
          firstId = c.id;
          break;
        }
        f = f.return;
        d++;
      }
      if (firstId) break;
    }
    return { label, hasNext, firstId };
  }

  return {
    filterMode,
    items: Array.from(byId.values()),
    pageInfo: readPageInfo(),
  };
}

// Click Nifty's next-page button (MAIN world, self-contained). The next
// button is the one immediately after the "N of M" indicator button.
function clickNextNiftyPage() {
  const indicator = Array.from(document.querySelectorAll("button")).find((b) =>
    /^\s*\d+\s+of\s+\d+\s*$/.test((b.textContent || "").trim())
  );
  if (!indicator) return { clicked: false, reason: "no-indicator" };
  const sibs = Array.from(indicator.parentElement.querySelectorAll("button"));
  const next = sibs[sibs.indexOf(indicator) + 1] || null;
  if (!next || next.disabled || next.getAttribute("aria-disabled") === "true") {
    return { clicked: false, reason: "no-next" };
  }
  next.click();
  return { clicked: true };
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


// ─── Delist on Mercari (Phase 7 worker, pilot) ──────────────────────────────
//
// Open in a signed-in mercari.com tab. Lists the Mercari delists FIA planned
// after a sale elsewhere. "Delist" opens My listings → Active, searches for
// the item, and (mercari-worker.js) ticks only that row and presses Mercari's
// own Deactivate; then it checks the Inactive tab and reports to FIA.
// Nifty keeps auto-delisting as the backup.

const MERCARI = "https://www.mercari.com";

async function waitForTabLoad(tabId, timeoutMs = 20000) {
  const start = Date.now();
  await sleep(400);
  while (Date.now() - start < timeoutMs) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return;
    await sleep(300);
  }
}

async function mercariGo(tabId, path) {
  await chrome.tabs.update(tabId, { url: MERCARI + path });
  await waitForTabLoad(tabId);
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["mercari-worker.js"] });
}

async function mercariRun(tabId, fnName, mercariId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (name, id) => {
      try {
        return await window[name](id);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    args: [fnName, mercariId],
  });
  return res?.result || { ok: false, error: "No result from the page" };
}

/** One leg: search Active, deactivate, verify on Inactive. Returns { result, detail }. */
async function mercariDelistOne(tabId, leg) {
  const q = encodeURIComponent(leg.search || leg.mercariId);
  await mercariGo(tabId, `/mypage/listings/active/?keyword=${q}&page=1`);
  const onActive = await mercariRun(tabId, "mercariFindRow", leg.mercariId);
  if (!onActive.found) {
    await mercariGo(tabId, `/mypage/listings/inactive/?keyword=${q}&page=1`);
    const onInactive = await mercariRun(tabId, "mercariFindRow", leg.mercariId);
    if (onInactive.found) return { result: "already_inactive", detail: "Already on Mercari's Inactive tab" };
    // Not in either list: ask the item page itself. Nifty's delist removes
    // the listing ("410 — Not Available").
    await mercariGo(tabId, `/us/item/${leg.mercariId}/`);
    const page = await mercariRun(tabId, "mercariItemState", leg.mercariId);
    if (page.state === "gone") return { result: "gone", detail: "Mercari says the listing is no longer available (removed)" };
    if (page.state === "sold") return { result: "gone", detail: "Sold on Mercari" };
    return { result: "not_found", detail: page.state === "showing" ? "Listing still shows on Mercari but wasn't found under My listings (title differs?) — check it" : "Not on Active or Inactive; item page unclear" };
  }
  const done = await mercariRun(tabId, "mercariDeactivateRow", leg.mercariId);
  if (!done.ok) return { result: "error", detail: done.error };
  await mercariGo(tabId, `/mypage/listings/inactive/?keyword=${q}&page=1`);
  const check = await mercariRun(tabId, "mercariFindRow", leg.mercariId);
  return check.found
    ? { result: "deactivated", detail: "Deactivated; seen on the Inactive tab" }
    : { result: "error", detail: "Left Active but not seen on Inactive; check Mercari" };
}

async function renderMercariDelists(tab) {
  const box = $("#mercari-delist");
  box.innerHTML = `<h2>Delist on Mercari (pilot)</h2><p class="muted">Checking foundinalabama.com…</p>`;
  let legs;
  try {
    legs = (await fiaFetch("/api/admin/sales/mercari-delists")).legs || [];
  } catch (err) {
    box.innerHTML = `<h2>Delist on Mercari (pilot)</h2><div class="alert error">${escapeHtml(err.message)}</div>`;
    return;
  }
  const when = (s) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  box.innerHTML = `
    <h2>Delist on Mercari (pilot)</h2>
    <p class="muted">Items that sold elsewhere and should come off Mercari. <strong>Delist</strong> uses this tab: My listings → finds the item → ticks only it → Mercari's own Deactivate → checks Inactive. Keep this popup open while it works. Nifty still delists on its own as the backup.</p>
    ${
      legs.length
        ? `<div id="mercari-legs" style="margin-top:8px;max-height:320px;overflow-y:auto">${legs
            .map(
              (l, i) => `<div style="border-top:1px solid rgba(0,0,0,.08);padding:6px 0">
                <div style="font-size:13px"><a href="${MERCARI}/us/item/${escapeHtml(l.mercariId)}/" target="_blank">${escapeHtml(l.title.slice(0, 70))}</a></div>
                <div class="muted" style="font-size:11px">Sold on ${escapeHtml(l.soldOn || "?")} ${escapeHtml(when(l.soldAt))} · ${escapeHtml(l.mercariId)}${
                  l.lastTry ? ` · last try: ${escapeHtml(l.lastTry.result.replace("_", " "))}` : ""
                }</div>
                <div class="row" style="margin-top:4px"><button data-i="${i}" class="mercari-go">Delist</button> <span class="mercari-out" data-i="${i}" style="font-size:12px"></span></div>
              </div>`
            )
            .join("")}</div>`
        : `<p class="muted">Nothing waiting. FIA lists a Mercari delist here after an item sells on another venue.</p>`
    }`;
  for (const b of box.querySelectorAll(".mercari-go")) {
    b.addEventListener("click", async () => {
      const i = Number(b.dataset.i);
      const leg = legs[i];
      const out = box.querySelector(`.mercari-out[data-i="${i}"]`);
      for (const x of box.querySelectorAll(".mercari-go")) x.disabled = true;
      out.textContent = "Working in this tab…";
      let r;
      try {
        r = await mercariDelistOne(tab.id, leg);
      } catch (err) {
        r = { result: "error", detail: err.message };
      }
      const color = ["deactivated", "already_inactive", "gone"].includes(r.result) ? "#166534" : "#7f1d1d";
      out.innerHTML = `<span style="color:${color}">${escapeHtml(r.result.replace("_", " "))}</span> — ${escapeHtml(r.detail || "")}`;
      try {
        await fiaFetch("/api/admin/sales/mercari-delists", { method: "POST", body: JSON.stringify({ legId: leg.legId, result: r.result, detail: r.detail }) });
      } catch (err) {
        out.insertAdjacentHTML("beforeend", ` <span style="color:#78350f">(couldn't tell FIA: ${escapeHtml(err.message)})</span>`);
      }
      for (const x of box.querySelectorAll(".mercari-go")) x.disabled = false;
      b.disabled = ["deactivated", "already_inactive", "gone"].includes(r.result);
    });
  }
}
