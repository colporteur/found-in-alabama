// Review panel (PANEL-1, extended PANEL-2), connector side: an MCP App.
// listing_review_panel is a normal read-only tool whose `_meta.ui.resourceUri`
// names a ui:// resource; a host that supports MCP Apps (claude.ai in a
// browser) reads that resource — the panel's HTML — and shows it beside the
// chat, then hands it the tool's structuredContent to draw. Hosts that don't
// (the desktop app, Nov 2026) just get the short text.
//
// The panel's buttons call the review_* tools below. Each does something Todd
// already does in the FIA admin:
//   review_request_fix   ask Claude to fix one draft or several (one note)
//   review_fix_decision  accept or undo a fix Claude finished
//   review_unverified    keep or remove a word Claude wasn't sure of
//   review_edit          change the title or price by hand
//   review_photo         turn a photo or change the photo order
// Each answers with the draft as it now stands, so the panel redraws one card.
//
// It does NOT approve. Approval stays in the FIA admin, behind Todd's own
// sign-in, because this server can't tell a click in the panel from a call
// Claude made. The review_* tools are marked visibility ["app"] (only a panel
// may call them), but that is enforced by the host, not here. That is why
// nothing a panel button does goes beyond what Todd can undo or redo in the
// admin: no approving, no publishing, no deleting.
//
// The panel's HTML is built from docs/mcp-ui/draft-review (see its README)
// into lib/mcp/ui/draft-review-html.ts. To remove the panel, see that README.

import { argEnum, argNum, argStr, panelResult, type ResourceDef, type ToolDef } from "./protocol";
import { panelPhotoChange, reviewPanelData, reviewPanelDraft } from "@/lib/listings/review-panel";
import { acceptFix, fixesReady, requestFixes, undoFix } from "@/lib/listings/fixes";
import { decideUnverified } from "@/lib/listings/review";
import { updateDraft, type DraftEdit } from "@/lib/listings/drafts";
import { DRAFT_REVIEW_HTML } from "./ui/draft-review-html";

export const REVIEW_PANEL_URI = "ui://fia/draft-review";
/** The MIME type an MCP App resource must have. */
export const MCP_APP_MIME = "text/html;profile=mcp-app";

function summaryText(d: Awaited<ReturnType<typeof reviewPanelData>>): string {
  if (!d.drafts.length) return "No drafts written by Claude are waiting in Review.";
  const lines = d.drafts.map((x) => {
    const bits = [
      x.price == null ? "no price" : `$${x.price.toFixed(2)}`,
      `${x.photos.length} photo${x.photos.length === 1 ? "" : "s"}`,
      x.openFix ? "fix requested" : x.doneFix ? "fix done, waiting for Todd" : null,
      x.needs.length ? `needs ${x.needs.join(", ")}` : null,
      x.flags.length ? `${x.flags.length} flag${x.flags.length === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    return `- ${x.id} | ${x.title ?? "(no title)"} | ${bits.join(" | ")}`;
  });
  const more = d.total > d.drafts.length ? ` (showing the ${d.drafts.length} most recent)` : "";
  return `${d.total} draft${d.total === 1 ? "" : "s"} written by Claude waiting in Review${more}. If the Claude app drew the panel, Todd can see them there; not every kind of chat draws it, so don't tell him it is open. Ask him whether he sees it, and if he doesn't, go over the drafts in text.\n${lines.join("\n")}`;
}

/** Marks a tool as callable by a panel only (the host hides it from Claude). */
const PANEL_ONLY = { ui: { visibility: ["app"] } };

/** What a panel button gets back: the draft as it now stands (null = it left Review). */
async function card(draftId: string) {
  const draft = await reviewPanelDraft(draftId);
  return panelResult(draft ? "Done." : "Done. That draft is no longer in Review.", { draft });
}

export function reviewPanelTools(who: string, site: string): ToolDef[] {
  return [
    {
      name: "listing_review_panel",
      title: "Show Claude's drafts in the review panel",
      description:
        "Opens Todd's review panel beside the chat: the drafts you wrote that are waiting in his Review queue, each with its photos, title, price, condition, description and flags. Call it when Todd asks to see, look over or review the drafts (instead of describing them in text), and again after you revise one so he sees the change. From the panel Todd can ask for a fix on one draft or several (it arrives as a fix request in listing_fixes and a message in the chat), accept or undo a fix you finished, keep or remove unverified words, edit a title or price himself, and turn or reorder photos, so a draft may have changed since you wrote it: read it again with listing_get_draft before revising. Nothing is approved from the panel; Todd approves in the FIA admin. You get back a short list of the same drafts. Some chats run the tool without drawing the panel, so never say the panel is open unless Todd confirms he sees it.",
      inputSchema: { type: "object", properties: { limit: { type: "number", default: 12, description: "How many drafts to show (most recent first, up to 24)" } } },
      meta: { ui: { resourceUri: REVIEW_PANEL_URI }, "ui/resourceUri": REVIEW_PANEL_URI },
      run: async (a) => {
        const data = await reviewPanelData(argNum(a, "limit", 12, 1, 24) ?? 12);
        return panelResult(summaryText(data), { ...data, site });
      },
    },
    {
      name: "review_request_fix",
      title: "Ask for a fix (review panel button)",
      readOnly: false,
      description:
        "Used by the review panel when Todd asks Claude to fix one draft, or several with one note. Files his fix request. Not for Claude to call: work fix requests with listing_fixes.",
      inputSchema: {
        type: "object",
        required: ["note"],
        properties: {
          draft_id: { type: "string", description: "One draft" },
          draft_ids: { type: "array", items: { type: "string" }, maxItems: 24, description: "Or several drafts that share the note" },
          note: { type: "string", description: "What Todd wants changed" },
        },
      },
      meta: PANEL_ONLY,
      run: async (a) => {
        if (!(await fixesReady())) throw new Error("Fix requests aren't set up yet (run the migration).");
        const ids = [
          ...(Array.isArray(a.draft_ids) ? (a.draft_ids as unknown[]).map(String) : []),
          ...(typeof a.draft_id === "string" ? [a.draft_id] : []),
        ].slice(0, 24);
        const note = argStr(a, "note", 4000) ?? "";
        const r = await requestFixes(ids, note, [], `${who} (review panel)`);
        if (!r.requested.length) throw new Error(r.skipped[0]?.reason ? `Can't ask for a fix: ${r.skipped[0].reason}` : "Can't ask for a fix on that draft.");
        return { ok: true, requested: r.requested, skipped: r.skipped };
      },
    },
    {
      name: "review_fix_decision",
      title: "Accept or undo a fix (review panel button)",
      readOnly: false,
      description:
        "Used by the review panel when Todd accepts a fix Claude finished, or undoes it (the draft goes back to how it was when he asked). Not for Claude to call.",
      inputSchema: {
        type: "object",
        required: ["draft_id", "fix_id", "decision"],
        properties: { draft_id: { type: "string" }, fix_id: { type: "string" }, decision: { type: "string", enum: ["accept", "undo"] } },
      },
      meta: PANEL_ONLY,
      run: async (a) => {
        const fixId = argStr(a, "fix_id", 40) ?? "";
        if (argEnum(a, "decision", ["accept", "undo"] as const, "accept") === "undo") await undoFix(fixId);
        else await acceptFix(fixId);
        return card(argStr(a, "draft_id", 40) ?? "");
      },
    },
    {
      name: "review_unverified",
      title: "Keep or remove an unverified word (review panel button)",
      readOnly: false,
      description:
        "Used by the review panel when Todd keeps or removes words Claude used that the item doesn't show. Removing takes them out of the title, description and item specifics. Not for Claude to call.",
      inputSchema: {
        type: "object",
        required: ["draft_id", "index", "decision"],
        properties: { draft_id: { type: "string" }, index: { type: "number" }, decision: { type: "string", enum: ["keep", "remove"] } },
      },
      meta: PANEL_ONLY,
      run: async (a) => {
        const id = argStr(a, "draft_id", 40) ?? "";
        const r = await decideUnverified(id, argNum(a, "index", 0, 0, 200) ?? 0, argEnum(a, "decision", ["keep", "remove"] as const, "keep"));
        if (!r.ok) throw new Error(r.error ?? "That couldn't be changed.");
        return card(id);
      },
    },
    {
      name: "review_edit",
      title: "Edit title or price (review panel)",
      readOnly: false,
      description:
        "Used by the review panel when Todd types a new title or price on a draft. Saved as his own hand edit, exactly as typed (no price rules are applied). Not for Claude to call: use listing_revise.",
      inputSchema: {
        type: "object",
        required: ["draft_id"],
        properties: { draft_id: { type: "string" }, title: { type: "string", description: "At most 80 characters" }, price: { type: "number" } },
      },
      meta: PANEL_ONLY,
      run: async (a) => {
        const id = argStr(a, "draft_id", 40) ?? "";
        const edit: DraftEdit = {};
        if ("title" in a) {
          const t = String(a.title ?? "").trim();
          if (t.length < 10) throw new Error("A title needs at least 10 characters.");
          if (t.length > 80) throw new Error(`That title is ${t.length} characters; eBay allows 80.`);
          edit.title = t;
        }
        if ("price" in a) {
          const p = Number(a.price);
          if (!Number.isFinite(p) || p <= 0 || p > 100000) throw new Error("Enter a price above zero.");
          edit.price = Math.round(p * 100) / 100;
        }
        if (!Object.keys(edit).length) throw new Error("Nothing to change.");
        if (!(await reviewPanelDraft(id))) throw new Error("That draft isn't in Review any more.");
        const r = await updateDraft(id, edit);
        if (!r.ok) throw new Error(r.error ?? "That couldn't be saved.");
        return card(id);
      },
    },
    {
      name: "review_photo",
      title: "Turn or reorder photos (review panel)",
      readOnly: false,
      description:
        "Used by the review panel when Todd turns a photo or changes the photo order on a draft (not a lot). Not for Claude to call: use listing_fix_photos on a draft Todd asked you to fix.",
      inputSchema: {
        type: "object",
        required: ["draft_id"],
        properties: {
          draft_id: { type: "string" },
          rotate: { type: "object", properties: { position: { type: "number" }, turn: { type: "number", enum: [90, -90, 180] } } },
          order: { type: "array", items: { type: "number" }, maxItems: 60, description: "Current photo positions in the order wanted" },
        },
      },
      meta: PANEL_ONLY,
      run: async (a) => {
        const id = argStr(a, "draft_id", 40) ?? "";
        const rot = a.rotate && typeof a.rotate === "object" ? (a.rotate as Record<string, unknown>) : null;
        await panelPhotoChange(id, {
          rotate: rot ? { position: Number(rot.position), turn: Number(rot.turn) } : undefined,
          order: Array.isArray(a.order) ? (a.order as unknown[]).map(Number) : undefined,
        });
        return card(id);
      },
    },
  ];
}

/** The panel's HTML. `photoOrigins` are the sites its <img> tags may load from
 *  (the panel runs in a sandbox that blocks every other origin). */
export function reviewPanelResources(photoOrigins: string[]): ResourceDef[] {
  return [
    {
      uri: REVIEW_PANEL_URI,
      name: "Draft review panel",
      description: "Interactive view for listing_review_panel",
      mimeType: MCP_APP_MIME,
      meta: { ui: { csp: { resourceDomains: photoOrigins }, prefersBorder: true } },
      read: async () => DRAFT_REVIEW_HTML,
    },
  ];
}

/** Where draft photos are served from (R2_PUBLIC_BASE), as an origin. */
export function photoOrigins(): string[] {
  try {
    const base = process.env.R2_PUBLIC_BASE?.trim();
    return base ? [new URL(base).origin] : [];
  } catch {
    return [];
  }
}
