// TES recategorize overlay — content script on theephemeralstate.com
// (and foundinalabama.com/tes preview paths).
//
// Injects a small ⇄ button on every product card (any element wrapping an
// /item/<ebayItemId> link). Clicking it opens a panel showing the item's
// two eBay Store Category slots; Todd marks which slot(s) are wrong and,
// per slot, either picks the replacement himself (searchable list) or
// lets the AI categorizer choose. Submitting queues the item in the
// site's tes_recat_queue; the background actuator later applies the
// change at the ROOT — in Nifty — so "Recreate" can't resurrect it.
//
// All API traffic goes through the background service worker
// (chrome.runtime.sendMessage) because MV3 content scripts are bound by
// the page's CORS; the worker has host permissions for the site.

(() => {
  const ITEM_LINK = /\/item\/(\d{9,})/; // eBay item ids are long digit runs

  function api(msg) {
    return chrome.runtime.sendMessage(msg).then(
      (r) => r ?? { ok: false, error: "No response from extension" },
      (e) => ({ ok: false, error: e.message })
    );
  }

  // ── Card decoration ────────────────────────────────────────────────────────

  function cardOf(link) {
    // TesItemCard root: the link's parent that also holds the footer rows.
    let el = link.parentElement;
    for (let i = 0; i < 4 && el; i++) {
      if (el.querySelectorAll("a").length >= 1 && el !== link && el.tagName === "DIV") return el;
      el = el.parentElement;
    }
    return link.parentElement;
  }

  function decorate() {
    for (const link of document.querySelectorAll('a[href*="/item/"]')) {
      const m = ITEM_LINK.exec(link.getAttribute("href") ?? "");
      if (!m) continue;
      const card = cardOf(link);
      if (!card || card.dataset.tesRecat) continue;
      card.dataset.tesRecat = m[1];
      card.classList.add("tes-recat-host");

      const btn = document.createElement("button");
      btn.className = "tes-recat-btn";
      btn.type = "button";
      btn.title = "Recategorize (eBay Store Categories)";
      btn.textContent = "⇄";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPanel(m[1], btn);
      });
      card.appendChild(btn);
    }
  }

  new MutationObserver(() => decorate()).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  decorate();

  // ── Panel ──────────────────────────────────────────────────────────────────

  let openEls = null;
  function closePanel() {
    openEls?.backdrop.remove();
    openEls?.panel.remove();
    openEls = null;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  async function openPanel(itemId, cardBtn) {
    closePanel();
    const backdrop = el("div", "tes-recat-backdrop");
    const panel = el("div", "tes-recat-panel");
    backdrop.addEventListener("click", closePanel);
    document.body.append(backdrop, panel);
    openEls = { backdrop, panel };

    panel.append(el("h3", null, "Recategorize"), el("div", "tes-recat-status", "Loading…"));

    const meta = await api({ type: "recatMeta", itemId });
    if (!openEls || openEls.panel !== panel) return; // closed meanwhile
    panel.textContent = "";

    const close = el("button", "tes-recat-close", "✕");
    close.addEventListener("click", closePanel);
    panel.append(close);

    if (!meta.ok) {
      panel.append(el("h3", null, "Recategorize"), errBox(meta.error));
      return;
    }

    panel.append(el("h3", null, meta.item.title));
    if (meta.alreadyQueued) {
      const s = el("div", "tes-recat-status tes-recat-ok", "Already queued — the actuator will handle it on its next run.");
      panel.append(s);
      cardBtn.classList.add("tes-recat-queued");
      cardBtn.textContent = "✓";
      return;
    }

    // Per-slot state: { flagged, mode: "ai"|"manual", categoryId }
    const state = { 1: null, 2: null };
    const slotBox = (num, slot) => {
      const box = el("div", "tes-recat-slot");
      const flag = el("label", "tes-recat-flag");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const text = el("span", null, `Slot ${num} is wrong: `);
      text.append(el("span", "tes-recat-path", slot ? slot.path : "(empty)"));
      flag.append(cb, text);
      box.append(flag);

      if (!slot) {
        cb.disabled = true; // nothing to fix in an empty slot
        return box;
      }

      const modes = el("div", "tes-recat-modes");
      const aiBtn = el("button", "tes-recat-active", "AI picks");
      aiBtn.type = "button";
      const meBtn = el("button", null, "I'll pick");
      meBtn.type = "button";
      modes.append(aiBtn, meBtn);
      modes.style.display = "none";

      const pick = el("div", "tes-recat-pick");
      const search = document.createElement("input");
      search.type = "text";
      search.placeholder = "Search categories…";
      const opts = el("div", "tes-recat-options");
      pick.append(search, opts);
      pick.style.display = "none";

      const renderOpts = () => {
        const q = search.value.trim().toLowerCase();
        opts.textContent = "";
        const hits = meta.categories
          .filter((c) => c.id !== slot.categoryId && (!q || c.path.toLowerCase().includes(q)))
          .slice(0, 40);
        for (const c of hits) {
          const o = el("div", c.id === state[num]?.categoryId ? "tes-recat-selected" : null, c.path);
          o.addEventListener("click", () => {
            state[num] = { flagged: true, mode: "manual", categoryId: c.id };
            search.value = c.path;
            renderOpts();
          });
          opts.append(o);
        }
        if (hits.length === 0) opts.append(el("div", null, "(no matches)"));
      };
      search.addEventListener("input", renderOpts);

      const setMode = (mode) => {
        state[num] = { flagged: cb.checked, mode, categoryId: state[num]?.categoryId };
        aiBtn.classList.toggle("tes-recat-active", mode === "ai");
        meBtn.classList.toggle("tes-recat-active", mode === "manual");
        pick.style.display = mode === "manual" ? "" : "none";
        if (mode === "manual") renderOpts();
      };
      aiBtn.addEventListener("click", () => setMode("ai"));
      meBtn.addEventListener("click", () => setMode("manual"));

      cb.addEventListener("change", () => {
        modes.style.display = cb.checked ? "" : "none";
        if (cb.checked) setMode(state[num]?.mode ?? "ai");
        else state[num] = null;
      });

      box.append(modes, pick);
      return box;
    };

    panel.append(slotBox(1, meta.item.slot1), slotBox(2, meta.item.slot2));

    const submit = el("button", "tes-recat-submit", "Queue recategorize");
    submit.type = "button";
    const status = el("div", "tes-recat-status");
    panel.append(submit, status);

    submit.addEventListener("click", async () => {
      const slots = [1, 2]
        .filter((n) => state[n]?.flagged)
        .map((n) => ({
          slot: n,
          mode: state[n].mode,
          categoryId: state[n].mode === "manual" ? state[n].categoryId : undefined,
        }));
      if (slots.length === 0) {
        showStatus(status, "Check at least one slot.", true);
        return;
      }
      for (const s of slots) {
        if (s.mode === "manual" && !s.categoryId) {
          showStatus(status, `Slot ${s.slot}: pick a category (or switch to AI).`, true);
          return;
        }
      }
      submit.disabled = true;
      showStatus(status, slots.some((s) => s.mode === "ai") ? "Asking the AI…" : "Queuing…");
      const res = await api({ type: "recatEnqueue", payload: { itemId, slots } });
      if (!res.ok) {
        submit.disabled = false;
        showStatus(status, res.error, true);
        return;
      }
      const lines = [];
      for (const n of [1, 2]) {
        const s = res.entry[`slot${n}`];
        if (s?.changed) lines.push(`Slot ${n}: ${s.old ?? "(empty)"} → ${s.new}`);
      }
      if (res.entry.aiReasoning) lines.push(`AI: ${res.entry.aiReasoning}`);
      showStatus(status, `Queued. ${lines.join("  ·  ")}`);
      cardBtn.classList.add("tes-recat-queued");
      cardBtn.textContent = "✓";
      setTimeout(closePanel, 3500);
    });
  }

  function errBox(text) {
    return el("div", "tes-recat-status tes-recat-err", text);
  }
  function showStatus(node, text, isErr) {
    node.textContent = text;
    node.className = `tes-recat-status ${isErr ? "tes-recat-err" : "tes-recat-ok"}`;
  }
})();
