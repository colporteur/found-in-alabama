// Review panel (PANEL-1), connector side: an MCP App. listing_review_panel is
// a normal read-only tool whose `_meta.ui.resourceUri` names a ui:// resource;
// a host that supports MCP Apps (the Claude apps) reads that resource — the
// panel's HTML — and shows it beside the chat, then hands it the tool's
// structuredContent to draw. Hosts that don't just get the short text.
//
// The panel can do two things besides show drafts:
//   • "Ask Claude to fix" calls review_request_fix, which files one of Todd's
//     ordinary fix requests (lib/listings/fixes) — the same thing the Fix box
//     on the Review page does — and then tells Claude in the chat.
//   • "Open in FIA" opens the draft's admin page in the browser.
// It does NOT approve. Approval stays in the FIA admin, behind Todd's own
// sign-in, because this server can't tell a click in the panel from a call
// Claude made: review_request_fix is marked visibility ["app"] (only a panel
// may call it), but that is enforced by the host, not here.
//
// The panel's HTML is built from docs/mcp-ui/draft-review (see its README)
// into lib/mcp/ui/draft-review-html.ts. To remove the panel, see that README.

import { argNum, argStr, panelResult, type ResourceDef, type ToolDef } from "./protocol";
import { reviewPanelData } from "@/lib/listings/review-panel";
import { fixesReady, requestFixes } from "@/lib/listings/fixes";
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
  return `${d.total} draft${d.total === 1 ? "" : "s"} written by Claude waiting in Review${more}. Todd is looking at them in the panel.\n${lines.join("\n")}`;
}

export function reviewPanelTools(who: string, site: string): ToolDef[] {
  return [
    {
      name: "listing_review_panel",
      title: "Show Claude's drafts in the review panel",
      description:
        "Opens Todd's review panel beside the chat: the drafts you wrote that are waiting in his Review queue, each with its photos, title, price, condition, description and flags. Call it when Todd asks to see, look over or review the drafts (instead of describing them in text), and again after you revise one so he sees the change. From the panel Todd can ask for a fix, which arrives as a fix request (listing_fixes) and a message in the chat. Nothing is approved from the panel; Todd approves in the FIA admin. You get back a short list of the same drafts.",
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
        "Used by the review panel when Todd clicks \"Ask Claude to fix\" on a draft and types a note. Files his fix request for that draft. Not for Claude to call: work fix requests with listing_fixes.",
      inputSchema: {
        type: "object",
        required: ["draft_id", "note"],
        properties: { draft_id: { type: "string" }, note: { type: "string", description: "What Todd wants changed" } },
      },
      meta: { ui: { visibility: ["app"] } },
      run: async (a) => {
        if (!(await fixesReady())) throw new Error("Fix requests aren't set up yet (run the migration).");
        const id = argStr(a, "draft_id", 40) ?? "";
        const note = argStr(a, "note", 4000) ?? "";
        const r = await requestFixes([id], note, [], `${who} (review panel)`);
        if (!r.requested.length) throw new Error(r.skipped[0]?.reason ? `Can't ask for a fix: ${r.skipped[0].reason}` : "Can't ask for a fix on that draft.");
        return { ok: true, draftId: id };
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
