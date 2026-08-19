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
  if (msg?.type === "recatItem") {
    recatItem(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ status: "failed", note: err.message }));
    return true; // async
  }
  return false;
});

// ═══ Recategorize (eBay Store Categories) ════════════════════════════════════
//
// Executes one recategorize per message: locate the row by title (unique
// match) → verify SKU → open the item DRAWER (?item=<uuid>) → expand the
// eBay section → open the "Store categories" popover (a MUI multi-select:
// chips for current values, a Search input, MuiListItemButton option rows
// with checkboxes and full "Parent > Child" path text) → REMOVE the wrong
// chips first (eBay caps at 2, so removing before adding never overflows
// the selection) → ADD the replacements via search → close the popover →
// click any Save/Update button that appears → verify the field text shows
// the new set. Located by TEXT, not CSS classes, wherever possible.

/** "Postcards > Other Vintage Postcards" — tolerant of ›/> and spacing. */
function normPath(s) {
  return (s ?? "")
    .replace(/\s*[>›]\s*/g, " > ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function leafOf(path) {
  const parts = (path ?? "").split(/\s*[>›]\s*/);
  return parts[parts.length - 1] ?? "";
}

function skuMatches(row, sku) {
  return new RegExp(
    `SKU:\\s*${sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
  ).test(row.textContent ?? "");
}

/** React-controlled inputs ignore .value writes — go through the native
 *  setter and fire an input event so the SPA's state actually updates. */
function setNativeValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The item drawer: a visible dialog/drawer container holding the item
 *  title AND the inline "Condition:" field row. */
function findDrawer(title) {
  const want = norm(title);
  const cands = [
    ...document.querySelectorAll(
      '[role="dialog"], [class*="MuiDrawer-paper"], [class*="Drawer"], [class*="MuiModal"] > div'
    ),
  ];
  return (
    cands.find(
      (d) =>
        isVisible(d) &&
        norm(d.textContent).includes(want) &&
        /condition:/i.test(d.textContent ?? "")
    ) ?? null
  );
}

function pressEscape() {
  const opts = { key: "Escape", code: "Escape", keyCode: 27, bubbles: true };
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", opts)
  );
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keyup", opts)
  );
}

/** Open the row's item drawer. Try the title node first, then the row's
 *  trailing action buttons (last-first — the drawer opener sits at the
 *  row's end). A wrong button may open a menu instead: if a menu with an
 *  "edit"-ish item appears, use it; otherwise Escape and try the next. */
async function openItemDrawer(row, titleNode, title) {
  let drawer = findDrawer(title);
  if (drawer) return drawer;

  click(titleNode);
  drawer = await waitFor(() => findDrawer(title), 4000);
  if (drawer) return drawer;

  const buttons = [...row.querySelectorAll('button, [role="button"]')]
    .filter(isVisible)
    .reverse()
    .slice(0, 4);
  for (const b of buttons) {
    click(b);
    drawer = await waitFor(() => findDrawer(title), 3000);
    if (drawer) return drawer;
    // A menu instead? Look for an Edit entry.
    const editItem = [
      ...document.querySelectorAll('[role="menuitem"], [role="option"], li'),
    ].find((m) => isVisible(m) && /^edit( item| listing)?$/i.test(m.textContent?.trim() ?? ""));
    if (editItem) {
      click(editItem);
      drawer = await waitFor(() => findDrawer(title), 4000);
      if (drawer) return drawer;
    }
    pressEscape();
    await sleep(400);
  }
  return null;
}

/** The "Store categories:" inline field inside the drawer's eBay section.
 *  Returns { label, value } — value is the clickable current-paths text. */
function storeCatField(drawer) {
  const label = [...drawer.querySelectorAll("*")].find(
    (e) =>
      e.children.length === 0 &&
      norm(e.textContent) === "store categories:" &&
      isVisible(e)
  );
  if (!label) return null;
  let box = label.parentElement;
  for (let i = 0; i < 3 && box; i++) {
    const value = [...box.querySelectorAll("*")].find(
      (e) =>
        e !== label &&
        e.children.length === 0 &&
        isVisible(e) &&
        (e.textContent ?? "").trim().length > 0 &&
        !/store categories:/i.test(e.textContent ?? "")
    );
    if (value) return { label, value };
    box = box.parentElement;
  }
  return { label, value: label };
}

async function expandEbaySection(drawer) {
  if (storeCatField(drawer)) return true;
  const btn = [...drawer.querySelectorAll('button, [role="button"]')].find(
    (b) => norm(b.textContent) === "ebay" && isVisible(b)
  );
  if (!btn) return false;
  click(btn);
  return !!(await waitFor(() => storeCatField(drawer), 6000));
}

/** The Store categories popover: heading "Store categories" + a Search
 *  input + checkbox option rows. */
function findCatPopover() {
  const heads = [...document.querySelectorAll("*")].filter(
    (e) =>
      e.children.length === 0 &&
      norm(e.textContent) === "store categories" &&
      isVisible(e)
  );
  for (const h of heads) {
    let p = h;
    for (let i = 0; i < 8 && p; i++) {
      p = p.parentElement;
      if (
        p &&
        p.querySelector('input[placeholder*="search" i]') &&
        p.querySelector('input[type="checkbox"]')
      )
        return p;
    }
  }
  return null;
}

function chipsIn(pop) {
  return [...pop.querySelectorAll('.MuiChip-root, [class*="MuiChip-root"]')].filter(
    (c) => isVisible(c) && c.querySelector("svg")
  );
}

async function removeCategoryChip(pop, path) {
  const target = normPath(path);
  const findChip = () => chipsIn(pop).find((c) => normPath(c.textContent) === target);
  const chip = findChip();
  if (!chip) return { ok: false, note: `Chip not found in popover: ${path}` };
  const del =
    chip.querySelector('[class*="deleteIcon"]') ?? chip.querySelector("svg");
  click(del);
  const gone = await waitFor(() => (findChip() ? null : true), 4000, 200);
  return gone ? { ok: true } : { ok: false, note: `Chip would not delete: ${path}` };
}

async function addCategory(pop, path) {
  const target = normPath(path);
  const present = () => chipsIn(pop).some((c) => normPath(c.textContent) === target);
  if (present()) return { ok: true };

  const search =
    pop.querySelector('input[placeholder*="search" i]') ??
    [...pop.querySelectorAll("input")].find((i) => i.type !== "checkbox");
  if (!search) return { ok: false, note: "Popover search input not found" };

  setNativeValue(search, leafOf(path));
  const optionRow = await waitFor(() => {
    return (
      [...pop.querySelectorAll('[class*="MuiListItemButton"]')].find(
        (r) => isVisible(r) && normPath(r.textContent) === target
      ) ?? null
    );
  }, 6000, 300);
  if (!optionRow) {
    setNativeValue(search, "");
    return { ok: false, note: `Option not found in list: ${path}` };
  }
  const cb = optionRow.querySelector('input[type="checkbox"]');
  if (!cb || !cb.checked) click(optionRow);
  const added = await waitFor(() => (present() ? true : null), 4000, 200);
  setNativeValue(search, "");
  await sleep(300);
  return added ? { ok: true } : { ok: false, note: `Selection didn't register: ${path}` };
}

async function closeCatPopover() {
  const pop = findCatPopover();
  if (!pop) return;
  // The popover header has a single icon button — its ✕.
  const x = [...pop.querySelectorAll("button")].find(
    (b) => isVisible(b) && norm(b.textContent) === "" && b.querySelector("svg")
  );
  if (x) click(x);
  else pressEscape();
  await waitFor(() => (findCatPopover() ? null : true), 4000, 200);
}

/** Some edits surface a labeled save/update button (drawer or dialog);
 *  click it if one appears within a few seconds. */
async function clickSaveIfPresent() {
  const labels = [
    "save changes",
    "save",
    "update listing",
    "update item",
    "update",
    "publish changes",
  ];
  const btn = await waitFor(() => {
    for (const l of labels) {
      const b = visibleButtonByText(l);
      if (b) return b;
    }
    return null;
  }, 3000, 400);
  if (btn) {
    click(btn);
    await sleep(1500);
    return true;
  }
  return false;
}

async function recatItem({ title, sku, remove, add }) {
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
  if (sku && !skuMatches(row, sku)) {
    return { status: "manual", note: `SKU mismatch (expected ${sku})` };
  }

  // 2. Drawer → eBay section → Store categories popover.
  const drawer = await openItemDrawer(row, titleNodes[0], title);
  if (!drawer) return { status: "manual", note: "Could not open the item drawer" };
  try {
    if (!(await expandEbaySection(drawer))) {
      return { status: "manual", note: "Could not expand the eBay section" };
    }
    const field = storeCatField(drawer);
    click(field.value);
    const pop = await waitFor(findCatPopover, 6000);
    if (!pop) return { status: "manual", note: "Store categories popover did not open" };

    // 3. Remove wrong chips FIRST (never exceed eBay's 2-category cap),
    //    then add replacements.
    for (const r of remove ?? []) {
      const res = await removeCategoryChip(pop, r.path);
      if (!res.ok) {
        await closeCatPopover();
        return { status: "failed", note: res.note };
      }
    }
    for (const a of add ?? []) {
      const res = await addCategory(pop, a.path);
      if (!res.ok) {
        await closeCatPopover();
        return { status: "failed", note: res.note };
      }
    }

    // 4. Close the popover; honor any save/update prompt.
    await closeCatPopover();
    await clickSaveIfPresent();

    // 5. Verify: the field's comma-joined paths show the new set.
    const verified = await waitFor(() => {
      const f = storeCatField(drawer);
      if (!f) return null;
      const segs = (f.value.textContent ?? "").split(",").map((s) => normPath(s));
      const hasAll = (add ?? []).every((a) => segs.includes(normPath(a.path)));
      const noneOld = (remove ?? []).every((r) => !segs.includes(normPath(r.path)));
      return hasAll && noneOld ? true : null;
    }, 10000, 500);

    return verified
      ? { status: "done" }
      : { status: "failed", note: "Edited the popover but the field never showed the new set" };
  } finally {
    pressEscape(); // leave the drawer closed and the page clean
  }
}
