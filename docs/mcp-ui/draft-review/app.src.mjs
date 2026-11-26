// FIA draft review panel: the script that runs inside the panel's sandboxed
// frame. Built into lib/mcp/ui/draft-review-html.ts by build.mjs (see README).
//
// It talks to the host (claude.ai) through the MCP Apps SDK:
//   ontoolresult      the host hands over listing_review_panel's result
//   callServerTool    Refresh, and every button that changes a draft (review_*)
//   sendMessage       tells Claude in the chat that a fix was asked for
//   openLink          opens a draft or the Review queue in the FIA admin
// Each review_* tool answers with the draft as it now stands, so only that
// card is redrawn. Everything from the server is put on the page as text
// (textContent), never as HTML.

import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const btn = (text, cls, onclick, label) => {
  const b = el("button", cls, text);
  b.type = "button";
  if (label) b.setAttribute("aria-label", label);
  b.onclick = onclick;
  return b;
};

const app = new App({ name: "FIA draft review", version: "2.0.0" });
let site = "https://www.foundinalabama.com";
let busy = false;
const SHOWN_PHOTOS = 5;
const drafts = new Map(); // id -> draft, in the order shown
const cards = new Map(); // id -> card element
const selected = new Set(); // ids ticked for a shared fix note
const photoMode = new Set(); // ids whose photo tools are showing
const allPhotos = new Set(); // ids whose photos are all showing

function setStatus(text, isError) {
  const s = $("status");
  s.textContent = text || "";
  s.className = (isError ? "err" : "muted") + " small";
}
const money = (n) => (n == null ? "No price" : "$" + Number(n).toFixed(2));
const errText = (e) => String((e && e.message) || e).replace(/^Error:\s*/, "");
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

async function open(url) {
  try {
    const r = await app.openLink({ url });
    if (r && r.isError) setStatus("Claude wouldn't open that link. Address: " + url, true);
  } catch (e) {
    setStatus("Couldn't open the link. Address: " + url, true);
  }
}

/** Calls a review_* tool. Returns its structuredContent, or throws with the server's message. */
async function call(name, args) {
  const r = await app.callServerTool({ name, arguments: args });
  if (r.isError) throw new Error((r.content && r.content[0] && r.content[0].text) || "That didn't work.");
  return r.structuredContent || {};
}

/** Runs a button's action on one card: dims the card, redraws it from the reply, reports errors. */
async function act(d, name, args, done) {
  const c = cards.get(d.id);
  if (c) c.classList.add("busy");
  try {
    const out = await call(name, { draft_id: d.id, ...args });
    setStatus(done || "Saved.");
    replaceCard(d.id, out.draft);
  } catch (e) {
    if (c) c.classList.remove("busy");
    setStatus(errText(e), true);
  }
}

function replaceCard(id, draft) {
  const old = cards.get(id);
  if (!draft) {
    // It left Review (approved, discarded or taken back in FIA).
    drafts.delete(id);
    cards.delete(id);
    selected.delete(id);
    if (old) old.remove();
    setStatus("That draft is no longer in Review.");
    updateBatch();
    return;
  }
  drafts.set(id, draft);
  const fresh = card(draft);
  cards.set(id, fresh);
  if (old) old.replaceWith(fresh);
}

async function tellClaude(text) {
  try {
    const m = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    return !(m && m.isError);
  } catch (e) {
    return false;
  }
}

// ── photos ───────────────────────────────────────────────────────────────────

function photoStrip(d) {
  const wrap = el("div", "photos");
  if (!d.photos.length) {
    wrap.append(el("span", "muted small", "No photos yet."));
    return wrap;
  }
  const tools = photoMode.has(d.id) && !d.openFix && !d.isLot;
  const positions = d.photos.map((p) => p.position);
  const move = (from, to) => {
    const order = positions.slice();
    order.splice(to, 0, order.splice(from, 1)[0]);
    act(d, "review_photo", { order }, "Photo order saved.");
  };
  const add = (p, i) => {
    const box = el("div", "ph");
    const img = el("img");
    img.loading = "lazy";
    img.alt = "Photo " + (i + 1);
    img.src = p.url;
    img.onclick = () => {
      $("zoom").firstElementChild.src = p.url;
      $("zoom").classList.add("on");
    };
    box.append(img);
    if (tools) {
      const t = el("div", "tools");
      const turn = (deg) => act(d, "review_photo", { rotate: { position: p.position, turn: deg } }, "Photo turned.");
      t.append(btn("↺", null, () => turn(-90), "Turn photo " + (i + 1) + " left"), btn("↻", null, () => turn(90), "Turn photo " + (i + 1) + " right"));
      const left = btn("←", null, () => move(i, i - 1), "Move photo " + (i + 1) + " earlier");
      const right = btn("→", null, () => move(i, i + 1), "Move photo " + (i + 1) + " later");
      const first = btn("1st", null, () => move(i, 0), "Make photo " + (i + 1) + " the first photo");
      left.disabled = first.disabled = i === 0;
      right.disabled = i === d.photos.length - 1;
      t.append(left, right, first);
      box.append(t);
    }
    wrap.append(box);
  };
  const showAll = tools || allPhotos.has(d.id);
  const shown = showAll ? d.photos : d.photos.slice(0, SHOWN_PHOTOS);
  shown.forEach(add);
  if (shown.length < d.photos.length) {
    wrap.append(
      btn("+" + (d.photos.length - shown.length) + " more", "more", () => {
        allPhotos.add(d.id);
        replaceCard(d.id, d);
      })
    );
  }
  return wrap;
}

// ── one card ─────────────────────────────────────────────────────────────────

function card(d) {
  const c = el("div", "card");
  const title = d.title || "(no title yet)";

  const head = el("div", "head");
  const tick = el("input");
  tick.type = "checkbox";
  tick.checked = selected.has(d.id);
  tick.disabled = !!d.openFix;
  tick.setAttribute("aria-label", "Select this draft for a shared fix note");
  tick.onchange = () => {
    if (tick.checked) selected.add(d.id);
    else selected.delete(d.id);
    updateBatch();
  };
  head.append(tick, el("p", "title", title));
  c.append(head);

  c.append(photoStrip(d));

  const facts = el("div", "facts small");
  facts.append(el("span", "price", money(d.price)));
  if (d.title) facts.append(el("span", d.title.length > 80 ? "err" : "muted", d.title.length + " of 80 title characters"));
  if (d.condition) facts.append(el("span", "muted", d.condition + (d.conditionNote ? " (" + d.conditionNote + ")" : "")));
  if (d.category) facts.append(el("span", "muted", d.category));
  if (d.bin) facts.append(el("span", "muted", "Bin " + d.bin));
  if (d.editedByTodd) facts.append(el("span", "muted", "You edited this"));
  c.append(facts);

  if (d.openFix) c.append(el("div", "note warn", "Fix requested, Claude hasn't finished: " + d.openFix));

  if (d.doneFix) {
    const f = el("div", "note ok");
    f.append(el("div", null, "Claude fixed it" + (d.doneFix.summary ? ": " + d.doneFix.summary : ".")));
    f.append(el("div", "small", "You asked: " + d.doneFix.note));
    if (d.doneFix.changes.length) {
      const ul = el("ul", "changes small");
      d.doneFix.changes.forEach((ch) => {
        const li = el("li", null, ch.field + ": " + short(ch.before, 160) + "  →  " + short(ch.after, 160));
        li.title = ch.before + "\n→\n" + ch.after;
        ul.append(li);
      });
      f.append(ul);
    } else {
      f.append(el("div", "small", "Nothing on the draft is different from when you asked."));
    }
    const row = el("div", "actions");
    row.append(
      btn("Accept", "primary", () => act(d, "review_fix_decision", { fix_id: d.doneFix.id, decision: "accept" }, "Fix accepted.")),
      btn("Undo the fix", null, () => act(d, "review_fix_decision", { fix_id: d.doneFix.id, decision: "undo" }, "Fix undone. The draft is back to how it was when you asked."))
    );
    f.append(row);
    c.append(f);
  }

  if (d.needs.length) c.append(el("div", "note warn", "Before it can be approved it needs: " + d.needs.join(", ") + "."));

  if (d.flags.length) {
    const f = el("div", "note warn");
    f.append(el("span", null, "Claude flagged:"));
    const ul = el("ul");
    d.flags.forEach((x) => ul.append(el("li", null, x)));
    f.append(ul);
    c.append(f);
  }

  const unv = (d.unverified || []).filter((u) => u.decision !== "removed");
  if (unv.length) {
    const f = el("div", "note warn");
    f.append(el("span", null, "Words the item itself doesn't show:"));
    const ul = el("ul");
    unv.forEach((u) => {
      const li = el("li", null, "“" + u.words + "”" + (u.basis ? " (" + u.basis + ")" : ""));
      if (u.decision === "kept") {
        li.append(el("span", "muted small", "  kept"));
      } else {
        const b = el("span", "inline");
        b.append(
          btn("Keep", null, () => act(d, "review_unverified", { index: u.index, decision: "keep" }, "Kept.")),
          btn("Remove", null, () => act(d, "review_unverified", { index: u.index, decision: "remove" }, "Removed from the title, description and item specifics."))
        );
        li.append(b);
      }
      ul.append(li);
    });
    f.append(ul);
    c.append(f);
  }

  if (d.description) {
    const long = d.description.length > 420;
    const desc = el("div", "desc" + (long ? " clamp" : ""), d.description);
    c.append(desc);
    if (long) {
      const t = btn("Show all " + d.description.length + " characters", "link small", () => {
        const clamped = desc.classList.toggle("clamp");
        t.textContent = clamped ? "Show all " + d.description.length + " characters" : "Show less";
      });
      c.append(t);
    }
  }

  // ── buttons ──
  const actions = el("div", "actions");
  const fixBtn = btn("Ask Claude to fix", null, () => {
    editBox.hidden = true;
    fixBox.hidden = false;
    ta.focus();
  });
  fixBtn.disabled = !!d.openFix;
  const editBtn = btn("Edit title or price", null, () => {
    fixBox.hidden = true;
    editBox.hidden = false;
    tIn.focus();
  });
  const photoBtn = btn(photoMode.has(d.id) ? "Done with photos" : "Fix photos", null, () => {
    if (photoMode.has(d.id)) photoMode.delete(d.id);
    else photoMode.add(d.id);
    replaceCard(d.id, d);
  });
  photoBtn.disabled = !d.photos.length || d.isLot || !!d.openFix;
  if (d.isLot) photoBtn.title = "FIA arranges a lot's photos. Change them on the draft page.";
  actions.append(fixBtn, editBtn, photoBtn, btn("Open in FIA to approve", null, () => open(site + "/admin/listings/" + d.id)));
  c.append(actions);

  // ── ask Claude to fix (this draft) ──
  const fixBox = el("div", "fixbox");
  fixBox.hidden = true;
  const ta = el("textarea");
  ta.placeholder = "What should change? For example: it's 1952, not 1925.";
  ta.maxLength = 4000;
  const row = el("div", "row");
  const msg = el("span", "small");
  const send = btn("Send to Claude", "primary", async () => {
    const note = ta.value.trim();
    if (!note) {
      msg.className = "small err";
      msg.textContent = "Say what needs fixing.";
      return;
    }
    send.disabled = true;
    msg.className = "small muted";
    msg.textContent = "Sending…";
    try {
      await call("review_request_fix", { draft_id: d.id, note });
    } catch (e) {
      send.disabled = false;
      msg.className = "small err";
      msg.textContent = errText(e);
      return;
    }
    // The fix request is saved. Now tell Claude in the chat so it starts on it.
    const told = await tellClaude('In the review panel I asked for a fix on "' + title + '": ' + note + "\n\nPlease work it from listing_fixes, then show me the review panel again.");
    selected.delete(d.id);
    updateBatch();
    replaceCard(d.id, { ...d, openFix: note, doneFix: null });
    setStatus(told ? "Fix requested." : "Fix request saved. Tell Claude to check its fix requests.");
  });
  row.append(send, btn("Cancel", null, () => (fixBox.hidden = true)), msg);
  fixBox.append(ta, row);
  c.append(fixBox);

  // ── edit title / price by hand ──
  const editBox = el("div", "editbox");
  editBox.hidden = true;
  const tLab = el("label", null, "Title");
  const tIn = el("input");
  tIn.type = "text";
  tIn.maxLength = 80;
  tIn.value = d.title || "";
  const count = el("span", "small muted");
  const showCount = () => (count.textContent = tIn.value.trim().length + " of 80 characters");
  tIn.oninput = showCount;
  showCount();
  tLab.append(tIn, count);
  const pLab = el("label", null, "Price ($), saved exactly as typed");
  const pIn = el("input", "price");
  pIn.type = "number";
  pIn.step = "0.01";
  pIn.min = "0";
  pIn.value = d.price == null ? "" : Number(d.price).toFixed(2);
  pLab.append(pIn);
  const eRow = el("div", "row actions");
  const eMsg = el("span", "small");
  const save = btn("Save", "primary", () => {
    const args = {};
    const t = tIn.value.trim();
    if (t !== (d.title || "")) args.title = t;
    if (pIn.value !== "" && Number(pIn.value) !== Number(d.price)) args.price = Number(pIn.value);
    if (!Object.keys(args).length) {
      eMsg.className = "small muted";
      eMsg.textContent = "Nothing changed.";
      return;
    }
    act(d, "review_edit", args, "Saved as your edit.");
  });
  eRow.append(save, btn("Cancel", null, () => (editBox.hidden = true)), eMsg);
  editBox.append(tLab, pLab, eRow);
  c.append(editBox);

  return c;
}

// ── several drafts, one note ─────────────────────────────────────────────────

function updateBatch() {
  for (const id of Array.from(selected)) if (!drafts.has(id) || drafts.get(id).openFix) selected.delete(id);
  $("batch").hidden = selected.size === 0;
  $("batchcount").textContent = selected.size + (selected.size === 1 ? " draft selected" : " drafts selected");
}

async function sendBatch() {
  const note = $("batchnote").value.trim();
  const msg = $("batchmsg");
  if (!note) {
    msg.className = "small err";
    msg.textContent = "Say what needs fixing.";
    return;
  }
  const ids = Array.from(selected);
  $("batchsend").disabled = true;
  msg.className = "small muted";
  msg.textContent = "Sending…";
  let out;
  try {
    out = await call("review_request_fix", { draft_ids: ids, note });
  } catch (e) {
    $("batchsend").disabled = false;
    msg.className = "small err";
    msg.textContent = errText(e);
    return;
  }
  $("batchsend").disabled = false;
  const asked = Array.isArray(out.requested) ? out.requested : ids;
  const titles = asked.map((id) => '"' + ((drafts.get(id) || {}).title || "untitled") + '"');
  const told = await tellClaude(
    "In the review panel I asked for one fix on " + asked.length + (asked.length === 1 ? " draft" : " drafts") + " (" + titles.join("; ") + "): " + note + "\n\nPlease work them from listing_fixes, then show me the review panel again."
  );
  asked.forEach((id) => {
    selected.delete(id);
    const d = drafts.get(id);
    if (d) replaceCard(id, { ...d, openFix: note, doneFix: null });
  });
  $("batchnote").value = "";
  msg.textContent = "";
  updateBatch();
  const skipped = Array.isArray(out.skipped) ? out.skipped.length : 0;
  setStatus("Fix requested on " + asked.length + (skipped ? "; " + skipped + " skipped" : "") + "." + (told ? "" : " Tell Claude to check its fix requests."));
}

// ── the whole list ───────────────────────────────────────────────────────────

function render(data) {
  if (!data || !Array.isArray(data.drafts)) return;
  if (typeof data.site === "string" && /^https?:\/\//.test(data.site)) site = data.site;
  const list = $("list");
  list.replaceChildren();
  drafts.clear();
  cards.clear();
  const n = data.drafts.length;
  const total = typeof data.total === "number" ? data.total : n;
  $("heading").textContent = total + (total === 1 ? " draft" : " drafts") + " in Review";
  if (!n) {
    list.append(el("p", "empty muted", "Nothing written by Claude is waiting in Review."));
    updateBatch();
    return;
  }
  data.drafts.forEach((d) => {
    drafts.set(d.id, d);
    const c = card(d);
    cards.set(d.id, c);
    list.append(c);
  });
  if (total > n) list.append(el("p", "muted small", "Showing the " + n + " most recent of " + total + ". The rest are in the Review queue."));
  updateBatch();
}

async function refresh() {
  if (busy) return;
  busy = true;
  $("refresh").disabled = true;
  setStatus("Refreshing…");
  try {
    render(await call("listing_review_panel", {}));
    setStatus("Updated " + new Date().toLocaleTimeString() + ".");
  } catch (e) {
    setStatus("Couldn't refresh: " + errText(e), true);
  } finally {
    busy = false;
    $("refresh").disabled = false;
  }
}

function applyContext(ctx) {
  if (!ctx) return;
  try {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles && ctx.styles.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx.styles && ctx.styles.css && ctx.styles.css.fonts) applyHostFonts(ctx.styles.css.fonts);
  } catch (e) {
    /* styling is optional */
  }
  const modes = Array.isArray(ctx.availableDisplayModes) ? ctx.availableDisplayModes : null;
  if (modes) $("expand").hidden = !modes.includes("fullscreen");
  if (ctx.displayMode) $("expand").textContent = ctx.displayMode === "fullscreen" ? "Shrink" : "Expand";
}

$("zoom").onclick = () => $("zoom").classList.remove("on");
$("refresh").onclick = refresh;
$("queue").onclick = () => open(site + "/admin/listings");
$("batchsend").onclick = sendBatch;
$("batchclear").onclick = () => {
  const ids = Array.from(selected);
  selected.clear();
  ids.forEach((id) => drafts.has(id) && replaceCard(id, drafts.get(id)));
  updateBatch();
};
$("expand").onclick = async () => {
  const now = (app.getHostContext() || {}).displayMode;
  try {
    const r = await app.requestDisplayMode({ mode: now === "fullscreen" ? "inline" : "fullscreen" });
    if (r && r.mode) $("expand").textContent = r.mode === "fullscreen" ? "Shrink" : "Expand";
  } catch (e) {
    /* the host keeps the current size */
  }
};

// Handlers go on before connect() so the first result isn't missed.
app.ontoolresult = (res) => {
  if (res && res.isError) {
    setStatus((res.content && res.content[0] && res.content[0].text) || "The tool reported an error.", true);
    return;
  }
  if (res && res.structuredContent) render(res.structuredContent);
};
app.onhostcontextchanged = (ctx) => applyContext({ ...(app.getHostContext() || {}), ...ctx });

app
  .connect()
  .then(() => applyContext(app.getHostContext()))
  .catch((e) => setStatus("Couldn't connect to Claude: " + errText(e), true));
