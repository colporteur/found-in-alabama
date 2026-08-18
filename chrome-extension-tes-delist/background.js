// TES Delist Actuator — background service worker.
//
// Every POLL_MINUTES: GET the delist queue from the site (Bearer API
// key). For each pending order, work its items one at a time:
//   - remainingQty > 0  → "manual" (other units still for sale; a Nifty
//     delist would kill ALL quantity everywhere — needs a human)
//   - else: drive the Nifty tab — search by title, verify SKU, ⋮ →
//     Delist item → Continue — via the content script.
// If every item of an order comes back "delisted", report completion so
// the order flips green in /admin/tes-orders. Anything less leaves the
// order pending (red) for manual follow-up.

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
  return false;
});

async function getConfig() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
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
  try {
    const cfg = await getConfig();
    if (!cfg.apiKey) {
      await log("No API key configured — open the popup and paste one.");
      return { ok: false, error: "No API key configured" };
    }

    const res = await fetch(`${cfg.apiBase}/api/tes/delist-queue`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) {
      await log(`Queue fetch failed: HTTP ${res.status}`);
      return { ok: false, error: `Queue HTTP ${res.status}` };
    }
    const queue = await res.json();
    const orders = queue.orders ?? [];
    await setBadge(orders.length);
    await chrome.storage.local.set({ lastPollAt: Date.now() });

    if (orders.length === 0) {
      if (trigger === "manual") await log("Queue empty — nothing to delist.");
      return { ok: true, orders: 0 };
    }

    await log(`${orders.length} order(s) need delisting (${trigger}).`);
    const tabId = await ensureNiftyTab();

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
        const r = await delistViaNifty(tabId, item);
        results.push({ itemId: item.itemId, status: r.status, note: r.note });
        await log(`${r.status.toUpperCase()}: ${item.title}${r.note ? ` — ${r.note}` : ""}`);
        await sleep(2500); // human-ish pacing between items
      }

      const allDelisted =
        results.length > 0 && results.every((r) => r.status === "delisted");
      await fetch(`${cfg.apiBase}/api/tes/delist-queue/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId: order.orderId, allDelisted, results }),
      });

      const title = allDelisted
        ? "Order fully delisted from Nifty"
        : "Order needs manual delist attention";
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon128.png",
        title,
        message: results
          .map((r) => `${r.status}: ${order.items.find((i) => i.itemId === r.itemId)?.title ?? r.itemId}`)
          .join("\n")
          .slice(0, 500),
      });
    }

    // Refresh badge with what's left
    const res2 = await fetch(`${cfg.apiBase}/api/tes/delist-queue`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (res2.ok) {
      const q2 = await res2.json();
      await setBadge((q2.orders ?? []).length);
    }
    return { ok: true, orders: orders.length };
  } catch (err) {
    await log(`Run failed: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    working = false;
  }
}

async function ensureNiftyTab() {
  const tabs = await chrome.tabs.query({ url: "https://app.nifty.ai/*" });
  if (tabs.length > 0) return tabs[0].id;
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

async function delistViaNifty(tabId, item) {
  try {
    // Navigate to the search deep-link — exact title query.
    await chrome.tabs.update(tabId, {
      url: `https://app.nifty.ai/inventory?query=${encodeURIComponent(item.title)}`,
    });
    await waitForTabLoad(tabId);
    await sleep(3500); // let the SPA render results

    const response = await chrome.tabs.sendMessage(tabId, {
      type: "delistItem",
      title: item.title,
      sku: item.sku,
    });
    return response ?? { status: "failed", note: "No response from content script" };
  } catch (err) {
    return { status: "failed", note: err.message };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
