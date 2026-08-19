const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  apiBase: "https://www.foundinalabama.com",
  apiKey: "",
  pollMinutes: 10,
};

async function refreshLog() {
  const { logLines = [], lastPollAt } = await chrome.storage.local.get({
    logLines: [],
    lastPollAt: null,
  });
  $("log").textContent = logLines.join("\n") || "(no activity yet)";
  if (lastPollAt) {
    $("status").textContent = `Last poll: ${new Date(lastPollAt).toLocaleTimeString()}`;
  }
}

async function init() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  $("apiKey").value = cfg.apiKey ?? "";
  $("apiBase").value = cfg.apiBase ?? DEFAULTS.apiBase;
  $("pollMinutes").value = cfg.pollMinutes ?? DEFAULTS.pollMinutes;
  await refreshLog();
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    apiBase: $("apiBase").value.trim().replace(/\/$/, ""),
    pollMinutes: Math.max(1, Number($("pollMinutes").value) || 10),
  });
  await chrome.runtime.sendMessage({ type: "reschedule" });
  $("status").textContent = "Saved.";
});

$("run").addEventListener("click", async () => {
  $("status").textContent = "Running…";
  const result = await chrome.runtime.sendMessage({ type: "runNow" });
  $("status").textContent = result?.ok
    ? `Done — ${result.orders ?? 0} order(s), ${result.recats ?? 0} recat(s) processed.`
    : `Failed: ${result?.error ?? "unknown"}`;
  await refreshLog();
});

init();
setInterval(refreshLog, 2000);
