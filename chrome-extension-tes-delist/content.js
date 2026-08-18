// TES Delist Actuator — content script on app.nifty.ai.
//
// Executes one delist per message via the CHECKBOX + bulk-bar flow
// (Todd's suggestion — far more robust than the ⋮ icon menu, whose
// buttons are anonymous icon-font blobs):
//   locate the row by title (must be a UNIQUE match) → verify SKU text →
//   tick the row checkbox (a native input) → click the labeled "Delist"
//   button in the bulk action bar → confirm the dialog → verify the
//   row's badges flip to "Delisted". Located by TEXT, not CSS classes.

function norm(s) {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs = 15000, stepMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(stepMs);
  }
  return null;
}

/** All heading-ish nodes whose normalized text equals the title. */
function findTitleNodes(title) {
  const want = norm(title);
  const nodes = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
  return nodes.filter((n) => norm(n.textContent) === want);
}

/** Climb from the title node to the row container (has SKU + checkbox). */
function rowFromTitle(node) {
  let el = node;
  for (let i = 0; i < 12 && el; i++) {
    el = el.parentElement;
    if (!el) break;
    const text = el.textContent ?? "";
    if (/SKU:/.test(text) && el.querySelector('input[type="checkbox"]'))
      return el;
  }
  return null;
}

/** Rect-based visibility — offsetParent is null for position:fixed
 *  elements (the bulk bar and dialogs are fixed), so never use it. */
function isVisible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Visible button whose exact text matches (bulk bar's "Delist" etc). */
function visibleButtonByText(label) {
  const want = norm(label);
  return (
    [...document.querySelectorAll('button, [role="button"]')].find(
      (b) => norm(b.textContent) === want && isVisible(b)
    ) ?? null
  );
}

/**
 * The delist confirmation dialog's confirm button. Two known wordings:
 *  - single-item (⋮ menu): "Are you sure you want to delist this item?
 *    Any unsold listings will be permanently deleted or ended…" → Continue
 *  - bulk bar: "Delist listings — This will permanently delete or end
 *    these N listings from the selected marketplaces." → Cancel / Delist
 * The "permanently/are you sure" phrase distinguishes the dialog from
 * the bulk bar itself (which also has a Delist button).
 */
function dialogConfirmButton() {
  const dialogs = [...document.querySelectorAll("div")].filter(
    (d) =>
      isVisible(d) &&
      /delist/i.test(d.textContent ?? "") &&
      /permanently delete|permanently deleted|are you sure/i.test(
        d.textContent ?? ""
      ) &&
      d.querySelector("button")
  );
  for (const d of dialogs.reverse()) {
    const btn = [...d.querySelectorAll("button")].find((b) =>
      ["continue", "delist", "confirm"].includes(norm(b.textContent))
    );
    if (btn && isVisible(btn)) return btn;
  }
  return null;
}

/**
 * Full human-like activation. Modern UI libraries (Radix & friends —
 * which Nifty's menus behave like) open on POINTER events, so a bare
 * .click() does nothing. Dispatch the whole sequence at the element's
 * center coordinates.
 */
function click(el) {
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const opts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  };
  el.dispatchEvent(new PointerEvent("pointerover", opts));
  el.dispatchEvent(new PointerEvent("pointerenter", opts));
  el.dispatchEvent(new PointerEvent("pointermove", opts));
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  if (typeof el.focus === "function") el.focus();
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}

async function delistItem({ title, sku }) {
  // 1. Locate the row — must be a unique title match.
  const titleNodes = await waitFor(() => {
    const t = findTitleNodes(title);
    return t.length > 0 ? t : null;
  });
  if (!titleNodes) return { status: "failed", note: "Item not found in search results" };
  if (titleNodes.length > 1)
    return { status: "manual", note: `Ambiguous: ${titleNodes.length} rows match the title` };

  const row = rowFromTitle(titleNodes[0]);
  if (!row) return { status: "failed", note: "Could not locate row container" };

  // 2. SKU sanity check (skip when the order has no SKU on file).
  if (sku && !new RegExp(`SKU:\\s*${sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(row.textContent ?? "")) {
    return { status: "manual", note: `SKU mismatch (expected ${sku})` };
  }

  // 3. Tick the row checkbox — a native input; the bulk action bar
  //    (Edit / Crosslist / … / Delist) appears at the bottom.
  const checkbox = row.querySelector('input[type="checkbox"]');
  if (!checkbox) return { status: "failed", note: "Row checkbox not found" };
  if (!checkbox.checked) checkbox.click();

  const delistBtn = await waitFor(() => visibleButtonByText("delist"), 8000);
  if (!delistBtn) {
    if (checkbox.checked) checkbox.click(); // leave the page clean
    return { status: "failed", note: "Bulk bar Delist button did not appear" };
  }

  // 4. Delist → confirmation dialog → Continue.
  click(delistBtn);
  const continueBtn = await waitFor(dialogConfirmButton, 8000);
  if (!continueBtn) {
    if (checkbox.checked) checkbox.click();
    return { status: "failed", note: "Confirmation dialog did not appear" };
  }
  click(continueBtn);

  // 5. Verify: the row shows "Delisted" badges (or leaves the Listed view).
  const verified = await waitFor(() => {
    const t = findTitleNodes(title);
    if (t.length === 0) return true; // row left the Listed filter
    const r = rowFromTitle(t[0]);
    return r && /delisted/i.test(r.textContent ?? "") ? true : null;
  }, 20000, 600);

  return verified
    ? { status: "delisted" }
    : { status: "failed", note: "Clicked Continue but never saw Delisted badges" };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "delistItem") {
    delistItem(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ status: "failed", note: err.message }));
    return true; // async
  }
  return false;
});
