// TES Delist Actuator — content script on app.nifty.ai.
//
// Executes one delist per message, following the recon'd flow exactly:
//   locate the row by title (must be a UNIQUE match) → verify SKU text →
//   open the row's ⋮ menu → click "Delist item" → click "Continue" in
//   the confirmation dialog → verify the row's badges flip to
//   "Delisted". Everything is located by TEXT, not CSS classes — the
//   Nifty SPA's class names churn; its words don't.

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

/** Climb from the title node to the row container (has SKU + buttons). */
function rowFromTitle(node) {
  let el = node;
  for (let i = 0; i < 10 && el; i++) {
    el = el.parentElement;
    if (!el) break;
    const text = el.textContent ?? "";
    const buttons = el.querySelectorAll("button");
    if (/SKU:/.test(text) && buttons.length >= 2) return el;
  }
  return null;
}

/** Candidate kebab buttons in the row: no text, has an svg. */
function kebabCandidates(row) {
  return [...row.querySelectorAll("button")].filter((b) => {
    const t = norm(b.textContent);
    return t === "" && b.querySelector("svg");
  });
}

function visibleMenuItem(label) {
  const want = norm(label);
  const items = [
    ...document.querySelectorAll('[role="menuitem"], [role="menu"] *, li, button, div'),
  ];
  return (
    items.find(
      (el) =>
        norm(el.textContent) === want &&
        el.offsetParent !== null &&
        el.childElementCount <= 2
    ) ?? null
  );
}

function dialogContinueButton() {
  const dialogs = [...document.querySelectorAll("div")].filter(
    (d) =>
      d.offsetParent !== null &&
      /delist this item/i.test(d.textContent ?? "") &&
      d.querySelector("button")
  );
  for (const d of dialogs.reverse()) {
    const btn = [...d.querySelectorAll("button")].find(
      (b) => norm(b.textContent) === "continue"
    );
    if (btn) return btn;
  }
  return null;
}

function click(el) {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  el.click();
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

  // 3. Open the ⋮ menu — try each icon-only button until "Delist item"
  //    appears (the row also has star/note icon buttons).
  let delistEntry = null;
  for (const candidate of kebabCandidates(row)) {
    click(candidate);
    delistEntry = await waitFor(() => visibleMenuItem("delist item"), 2500);
    if (delistEntry) break;
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    await sleep(300);
  }
  if (!delistEntry) return { status: "failed", note: "Could not open the ⋮ menu / find Delist item" };

  // 4. Delist item → confirmation dialog → Continue.
  click(delistEntry);
  const continueBtn = await waitFor(dialogContinueButton, 8000);
  if (!continueBtn) return { status: "failed", note: "Confirmation dialog did not appear" };
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
