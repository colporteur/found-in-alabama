// FIA draft review panel: the script that runs inside the panel's sandboxed
// frame. Built into lib/mcp/ui/draft-review-html.ts by build.mjs (see README).
//
// It talks to the host (the Claude app) through the MCP Apps SDK:
//   ontoolresult      the host hands over listing_review_panel's result
//   callServerTool    Refresh, and "Ask Claude to fix" (review_request_fix)
//   sendMessage       tells Claude in the chat that a fix was asked for
//   openLink          opens a draft or the Review queue in the FIA admin
// Everything from the server is put on the page as text (textContent), never
// as HTML.

import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const app = new App({ name: "FIA draft review", version: "1.0.0" });
let site = "https://www.foundinalabama.com";
let busy = false;
const SHOWN_PHOTOS = 5;

function setStatus(text, isError) {
  const s = $("status");
  s.textContent = text || "";
  s.className = (isError ? "err" : "muted") + " small";
}

function money(n) {
  return n == null ? "No price" : "$" + Number(n).toFixed(2);
}

async function open(url) {
  try {
    const r = await app.openLink({ url });
    if (r && r.isError) setStatus("Claude wouldn't open that link. Address: " + url, true);
  } catch (e) {
    setStatus("Couldn't open the link. Address: " + url, true);
  }
}

function photoStrip(d) {
  const wrap = el("div", "photos");
  if (!d.photos.length) {
    wrap.append(el("span", "muted small", "No photos yet."));
    return wrap;
  }
  const add = (p) => {
    const img = el("img");
    img.loading = "lazy";
    img.alt = "Photo " + p.position;
    img.src = p.url;
    img.onclick = () => {
      $("zoom").firstElementChild.src = p.url;
      $("zoom").classList.add("on");
    };
    wrap.append(img);
  };
  d.photos.slice(0, SHOWN_PHOTOS).forEach(add);
  const rest = d.photos.slice(SHOWN_PHOTOS);
  if (rest.length) {
    const more = el("button", "more", "+" + rest.length + " more");
    more.onclick = () => {
      more.remove();
      rest.forEach(add);
    };
    wrap.append(more);
  }
  return wrap;
}

function card(d) {
  const c = el("div", "card");
  c.append(photoStrip(d));

  const title = d.title || "(no title yet)";
  c.append(el("p", "title", title));
  const facts = el("div", "facts small");
  facts.append(el("span", "price", money(d.price)));
  if (d.title) facts.append(el("span", d.title.length > 80 ? "err" : "muted", d.title.length + " of 80 title characters"));
  if (d.condition) facts.append(el("span", "muted", d.condition + (d.conditionNote ? " (" + d.conditionNote + ")" : "")));
  if (d.category) facts.append(el("span", "muted", d.category));
  if (d.bin) facts.append(el("span", "muted", "Bin " + d.bin));
  if (d.editedByTodd) facts.append(el("span", "muted", "You edited this"));
  c.append(facts);

  if (d.openFix) c.append(el("div", "note warn", "Fix requested, Claude hasn't finished: " + d.openFix));
  if (d.doneFix) c.append(el("div", "note ok", "Claude fixed it: " + d.doneFix + " Accept or undo that in FIA."));
  if (d.needs.length) c.append(el("div", "note warn", "Before it can be approved it needs: " + d.needs.join(", ") + "."));
  if (d.flags.length) {
    const f = el("div", "note warn");
    f.append(el("span", null, "Claude flagged:"));
    const ul = el("ul");
    d.flags.forEach((x) => ul.append(el("li", null, x)));
    f.append(ul);
    c.append(f);
  }

  if (d.description) {
    const long = d.description.length > 420;
    const desc = el("div", "desc" + (long ? " clamp" : ""), d.description);
    c.append(desc);
    if (long) {
      const t = el("button", "link small", "Show all " + d.description.length + " characters");
      t.onclick = () => {
        const clamped = desc.classList.toggle("clamp");
        t.textContent = clamped ? "Show all " + d.description.length + " characters" : "Show less";
      };
      c.append(t);
    }
  }

  const actions = el("div", "actions");
  const fixBtn = el("button", null, "Ask Claude to fix");
  const openBtn = el("button", null, "Open in FIA to approve or edit");
  openBtn.onclick = () => open(site + "/admin/listings/" + d.id);
  actions.append(fixBtn, openBtn);
  c.append(actions);

  const box = el("div", "fixbox");
  box.hidden = true;
  const ta = el("textarea");
  ta.placeholder = "What should change? For example: it's 1952, not 1925.";
  ta.maxLength = 4000;
  const row = el("div", "row");
  const send = el("button", "primary", "Send to Claude");
  const cancel = el("button", null, "Cancel");
  const msg = el("span", "small");
  row.append(send, cancel, msg);
  box.append(ta, row);
  c.append(box);

  fixBtn.disabled = !!d.openFix;
  fixBtn.onclick = () => {
    box.hidden = false;
    ta.focus();
  };
  cancel.onclick = () => {
    box.hidden = true;
  };
  send.onclick = async () => {
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
      const r = await app.callServerTool({ name: "review_request_fix", arguments: { draft_id: d.id, note } });
      if (r.isError) throw new Error((r.content && r.content[0] && r.content[0].text) || "The request failed.");
    } catch (e) {
      send.disabled = false;
      msg.className = "small err";
      msg.textContent = String((e && e.message) || e).replace(/^Error:\s*/, "");
      return;
    }
    // The fix request is saved. Now tell Claude in the chat so it starts on it.
    let told = true;
    try {
      const m = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: 'In the review panel I asked for a fix on "' + title + '": ' + note + "\n\nPlease work it from listing_fixes, then show me the review panel again." }],
      });
      if (m && m.isError) told = false;
    } catch (e) {
      told = false;
    }
    box.hidden = true;
    fixBtn.disabled = true;
    c.insertBefore(el("div", "note warn", "Fix requested: " + note + (told ? "" : " (Saved. Tell Claude to check its fix requests.)")), actions);
  };

  return c;
}

function render(data) {
  if (!data || !Array.isArray(data.drafts)) return;
  if (typeof data.site === "string" && /^https?:\/\//.test(data.site)) site = data.site;
  const list = $("list");
  list.replaceChildren();
  const n = data.drafts.length;
  const total = typeof data.total === "number" ? data.total : n;
  $("heading").textContent = total + (total === 1 ? " draft" : " drafts") + " in Review";
  if (!n) {
    list.append(el("p", "empty muted", "Nothing written by Claude is waiting in Review."));
    return;
  }
  data.drafts.forEach((d) => list.append(card(d)));
  if (total > n) list.append(el("p", "muted small", "Showing the " + n + " most recent of " + total + ". The rest are in the Review queue."));
}

async function refresh() {
  if (busy) return;
  busy = true;
  $("refresh").disabled = true;
  setStatus("Refreshing…");
  try {
    const r = await app.callServerTool({ name: "listing_review_panel", arguments: {} });
    if (r.isError) throw new Error((r.content && r.content[0] && r.content[0].text) || "Refresh failed.");
    render(r.structuredContent);
    setStatus("Updated " + new Date().toLocaleTimeString() + ".");
  } catch (e) {
    setStatus("Couldn't refresh: " + String((e && e.message) || e), true);
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
  .catch((e) => setStatus("Couldn't connect to Claude: " + String((e && e.message) || e), true));
