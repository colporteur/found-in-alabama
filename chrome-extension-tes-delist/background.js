// TES Actuator — background service worker.
//
// Every POLL_MINUTES (and on "Run now"): work BOTH site queues against
// Nifty, one item at a time, via the content script on app.nifty.ai:
//
// 1. Delist queue (GET /api/tes/delist-queue): for each paid order's
//    items — remainingQty > 0 → "manual" (a Nifty delist would kill ALL
//    quantity everywhere); else search by title, verify SKU, checkbox →
//    bulk-bar Delist → Continue. Completion reported per order.
//
// 2. Recategorize queue (GET /api/tes/recat-queue): items flagged from
//    the storefront overlay as sitting in the wrong eBay Store Category
//    slot(s). The change must happen in NIFTY (the root) or "Recreate"
//    reverts it: search by title, open the item drawer, expand the eBay
//    section, rewrite the Store categories multi-select, verify.
//    Outcome reported per entry (/api/tes/recat-queue/complete).
//
// Also proxies the storefront overlay's API calls (recatMeta /
// recatEnqueue) — MV3 content scripts are bound by page CORS, the
// worker isn't.

const DEFAULTS = {
  apiBase: "https://www.foundinalabama.com",
  apiKey: "",
  pollMinutes: 10,
};

const ALARM = "tes-delist-poll";
let working = false; // one run at a time

chrome.runtime.onInstalled.addListener(() => schedule());
chrome.runtime.onStartup.addListener(() => schedule());

async function schedule() {
  const { pollMinutes } = await getConfig();
  chrome.alarms.create(ALARM, { periodInMinutes: Math.max(1, pollMinutes) });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) runQueue("alarm");
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "runNow") {
    runQueue("manual").then((summary) => sendResponse(summary));
    return true; // async response
  }
  if (msg?.type === "reschedule") {
    schedule().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "recatMeta") {
    apiFetch(`/api/tes/recat-queue/meta?itemId=${encodeURIComponent(msg.itemId ?? "")}`)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === "recatEnqueue") {
    apiFetch("/api/tes/recat-queue", {
      method: "POST",
      body: JSON.stringify(msg.payload ?? {}),
    })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  return false;
});

async function getConfig() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

/** Authenticated fetch against the site; returns parsed JSON (the site's
 *  {ok, ...} envelope) even on HTTP errors, so callers see the message. */
async function apiFetch(path, init = {}) {
  const cfg = await getConfig();
  if (!cfg.apiKey) return { ok: false, error: "No API key configured — open the extension popup." };
  const res = await fetch(`${cfg.apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  try {
    return await res.json();
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
}

async function log(line) {
  const { logLines = [] } = await chrome.storage.local.get({ logLines: [] });
  logLines.unshift(`${new Date().toLocaleTimeString()} ${line}`);
  await chrome.storage.local.set({ logLines: logLines.slice(0, 50) });
}

async function setBadge(n) {
  await chrome.action.setBadgeText({ text: n > 0 ? String(n) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
}

async function runQueue(trigger) {
  if (working) return { ok: false, error: "Already running" };
  working = true;
  let workTabId = null;
  try {
    const cfg = await getConfig();
    if (!cfg.apiKey) {
      await log("No API key configured — open the popup and paste one.");
      return { ok: false, error: "No API key configured" };
    }

    const [delistQ, recatQ] = await Promise.all([
      apiFetch("/api/tes/delist-queue"),
      apiFetch("/api/tes/recat-queue"),
    ]);
    if (delistQ.ok === false && recatQ.ok === false) {
      await log(`Queue fetch failed: ${delistQ.error}`);
      return { ok: false, error: delistQ.error };
    }
    const orders = delistQ.orders ?? [];
    const recats = recatQ.entries ?? [];
    await setBadge(orders.length + recats.length);
    await chrome.storage.local.set({ lastPollAt: Date.now() });

    if (orders.length === 0 && recats.length === 0) {
      if (trigger === "manual") await log("Queues empty — nothing to do.");
      return { ok: true, orders: 0, recats: 0 };
    }

    workTabId = await createWorkTab();
    const tabId = workTabId;

    // ── 1. Delist queue ─────────────────────────────────────────────────────
    if (orders.length > 0) await log(`${orders.length} order(s) need delisting (${trigger}).`);
    for (const order of orders) {
      const results = [];
      for (const item of order.items) {
        if ((item.remainingQty ?? 0) > 0) {
          results.push({
            itemId: item.itemId,
            status: "manual",
            note: `${item.remainingQty} units still for sale — reduce quantity by hand`,
          });
          await log(`MANUAL (multi-qty): ${item.title}`);
          continue;
        }
        const r = await runOnNifty(tabId, { type: "delistItem", title: item.title, sku: item.sku });
        results.push({ itemId: item.itemId, status: r.status, note: r.note });
        await log(`${r.status.toUpperCase()}: ${item.title}${r.note ? ` — ${r.note}` : ""}`);
        await sleep(2500); // human-ish pacing between items
      }

      const allDelisted =
        results.length > 0 && results.every((r) => r.status === "delisted");
      await apiFetch("/api/tes/delist-queue/complete", {
        method: "POST",
        body: JSON.stringify({ orderId: order.orderId, allDelisted, results }),
      });

      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon128.png",
        title: allDelisted
          ? "Order fully delisted from Nifty"
          : "Order needs manual delist attention",
        message: results
          .map((r) => `${r.status}: ${order.items.find((i) => i.itemId === r.itemId)?.title ?? r.itemId}`)
          .join("\n")
          .slice(0, 500),
      });
    }

    // ── 2. Recategorize queue ───────────────────────────────────────────────
    if (recats.length > 0) await log(`${recats.length} item(s) need recategorizing (${trigger}).`);
    let recatFailures = 0;
    for (const entry of recats) {
      const r = await runOnNifty(tabId, {
        type: "recatItem",
        title: entry.title,
        sku: entry.sku,
        remove: entry.remove, // [{id, path}] — Nifty-format paths (advisory)
        add: entry.add,
        target: entry.target, // the FINAL desired set — the actuator reconciles to this
      });
      const status = r.status === "done" ? "done" : r.status === "manual" ? "manual" : "failed";
      if (status !== "done") recatFailures++;
      await apiFetch("/api/tes/recat-queue/complete", {
        method: "POST",
        body: JSON.stringify({ id: entry.id, status, note: r.note }),
      });
      await log(
        `RECAT ${status.toUpperCase()}: ${entry.title}${r.note ? ` — ${r.note}` : ""}`
      );
      await sleep(2500);
    }
    if (recats.length > 0) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon128.png",
        title:
          recatFailures === 0
            ? `Recategorized ${recats.length} item(s) in Nifty`
            : `Recategorize: ${recats.length - recatFailures} ok, ${recatFailures} need attention`,
        message: recats.map((e) => e.title).join("\n").slice(0, 500),
      });
    }

    // Refresh badge with what's left.
    const [d2, r2] = await Promise.all([
      apiFetch("/api/tes/delist-queue"),
      apiFetch("/api/tes/recat-queue"),
    ]);
    await setBadge((d2.orders ?? []).length + (r2.entries ?? []).length);
    return { ok: true, orders: orders.length, recats: recats.length };
  } catch (err) {
    await log(`Run failed: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    if (workTabId != null) {
      try {
        await chrome.tabs.remove(workTabId);
      } catch {
        // already closed — fine
      }
    }
    working = false;
  }
}

/** A dedicated background tab for this run, closed when the run ends —
 *  never commandeer an existing Nifty tab: Todd drafts in Nifty all day
 *  and the old ensureNiftyTab() would navigate away his work-in-progress. */
async function createWorkTab() {
  const tab = await chrome.tabs.create({
    url: "https://app.nifty.ai/inventory",
    active: false,
  });
  await waitForTabLoad(tab.id);
  await sleep(4000); // SPA boot
  return tab.id;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);
  });
}

/** Navigate the Nifty tab to a title search, then hand one work message
 *  to the content script (delistItem / recatItem). */
async function runOnNifty(tabId, msg) {
  try {
    await chrome.tabs.update(tabId, {
      url: `https://app.nifty.ai/inventory?query=${encodeURIComponent(msg.title)}`,
    });
    await waitForTabLoad(tabId);
    await sleep(3500); // let the SPA render results

    const response = await chrome.tabs.sendMessage(tabId, msg);
    return response ?? { status: "failed", note: "No response from content script" };
  } catch (err) {
    return { status: "failed", note: err.message };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
