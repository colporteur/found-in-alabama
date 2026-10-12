// Phase 7, Mercari worker step 2 — "Delist on Mercari" (pilot).
// Runs in Todd's own signed-in mercari.com tab (MAIN world), and only does
// what he could do by hand: on My listings it finds the ONE row whose link
// is the listing's m-number, ticks it, and presses Mercari's own Deactivate
// button. Then the popup opens the Inactive tab and checks it is there.
// It never deletes, never edits, and refuses to act if anything other than
// that single row ends up ticked.

/* eslint-disable no-unused-vars */
async function mercariFindRow(mercariId) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Rows load after the page; wait up to ~12s for the table.
  for (let i = 0; i < 24; i++) {
    const link = document.querySelector(`a[href*="/item/${mercariId}"]`);
    const loading = document.querySelector("tbody tr td div:empty");
    if (link) return { found: true };
    const rows = document.querySelectorAll("tbody tr a[href*='/item/m']").length;
    if (rows > 0 && i > 6 && !loading) return { found: false, rowsShown: rows };
    if (/No (items|listings)|no results/i.test(document.body.innerText) && i > 4) return { found: false, rowsShown: 0 };
    await sleep(500);
  }
  return { found: false, rowsShown: document.querySelectorAll("tbody tr a[href*='/item/m']").length, timedOut: true };
}

async function mercariDeactivateRow(mercariId) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!/\/mypage\/listings\/active\//.test(location.pathname)) return { ok: false, error: "Not on My listings → Active" };
  const link = document.querySelector(`a[href*="/item/${mercariId}"]`);
  if (!link) return { ok: false, error: "Listing row not found" };
  let row = link;
  while (row && row.tagName !== "TR") row = row.parentElement;
  if (!row) return { ok: false, error: "Couldn't find the listing's row" };
  const cb = row.querySelector("input[type=checkbox]");
  if (!cb) return { ok: false, error: "No checkbox on the row" };

  // Nothing else may be ticked (the first checkbox on the page is Select all).
  const rowBoxes = () => [...document.querySelectorAll("tbody input[type=checkbox]")];
  if (rowBoxes().some((b) => b.checked && b !== cb)) return { ok: false, error: "Another row is already ticked; untick it and try again" };
  if (!cb.checked) cb.click();
  await sleep(600);
  const ticked = rowBoxes().filter((b) => b.checked);
  if (ticked.length !== 1 || ticked[0] !== cb) {
    if (cb.checked) cb.click();
    return { ok: false, error: `Expected exactly this row ticked, found ${ticked.length}` };
  }
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Deactivate");
  if (!btn || btn.disabled) {
    if (cb.checked) cb.click();
    return { ok: false, error: "Mercari's Deactivate button isn't available" };
  }
  btn.click();
  // Wait for Mercari to finish ("Updating…" then the row leaves Active).
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (!document.querySelector(`a[href*="/item/${mercariId}"]`)) return { ok: true };
    if (/something went wrong|try again/i.test(document.body.innerText)) return { ok: false, error: "Mercari reported an error" };
  }
  return { ok: false, error: "Mercari didn't confirm within 15 seconds; check My listings" };
}

if (typeof module !== "undefined") module.exports = { mercariFindRow, mercariDeactivateRow };
