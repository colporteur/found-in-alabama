# Draft review panel (PANEL-1)

A panel the FIA connector opens beside a Claude chat. It shows the drafts Claude
wrote that are waiting in Review, with photos, and lets Todd ask Claude for a fix
without leaving the chat. It is an "MCP App": interactive UI served by the
connector itself. Added 2026-11-25 as a pilot.

## What it does

- Claude calls the `listing_review_panel` tool (for example when Todd says "show me
  the review panel"). claude.ai reads the panel's page from the connector and shows
  it beside the chat; the tool's result is the list of drafts the page draws.
- Each draft shows its photos (click to enlarge), title with a character count,
  price, condition, category, bin, Claude's flags, what it still needs before it can
  be approved, and any fix request.

Buttons on each draft (PANEL-2, 2026-11-25):

- **Ask Claude to fix** files an ordinary fix request (the same as the Fix box on the
  Review page) and posts a message in the chat so Claude starts on it. Ticking the
  boxes on several drafts opens one note for all of them (a batch fix request).
- **Accept / Undo the fix** appear when Claude has finished a fix, under a list of
  what changed (before and after). Undo puts the draft back as it was when Todd asked.
- **Keep / Remove** on each word Claude used that the item doesn't show. Remove takes
  the words out of the title, description and item specifics, as on the Review page.
- **Edit title or price** saves Todd's own edit, exactly as typed. No price rules run
  (no .87 ending, no floors, venue prices unchanged), the same as editing in the admin.
- **Fix photos** shows turn and move buttons under each photo. Not offered for lots,
  whose photos FIA arranges, or while Claude is working a fix on the draft. Photos
  can't be removed here: ask Claude to fix it, which can be undone.
- **Open in FIA to approve** opens the draft's admin page in the browser.

**Refresh** reloads the list. **Expand** asks for the full-screen view where offered.

It draws on claude.ai in a browser, including project chats. The Claude desktop app
ran the tool without drawing the panel when this was written.

## What it does not do

It does not approve, publish, send anything to Nifty, or delete anything. Approval
stays in the FIA admin behind Todd's own sign-in. The connector cannot tell a click
in the panel from a tool call Claude made, so an approve button here would let Claude
approve if the Claude app ever exposed that tool to it. The panel's buttons call
`review_*` tools marked for the panel only (`_meta.ui.visibility: ["app"]`), but that
rule is applied by the Claude app, not by this server. So the buttons are limited to
things Todd can undo or redo in the admin.

## Where the code is

| File | What it is |
| --- | --- |
| `lib/mcp/protocol.ts` | The connector's protocol layer. Now also answers `resources/list` and `resources/read`, sends a tool's `_meta`, and can return `structuredContent` (`panelResult`). |
| `lib/mcp/review-panel-tools.ts` | `listing_review_panel`, the `review_*` button tools, and the `ui://fia/draft-review` resource. |
| `lib/listings/review-panel.ts` | The query behind the panel, one-draft reload, and the photo turn / reorder action. |
| `lib/mcp/ui/draft-review-html.ts` | GENERATED. The whole panel page as one string. |
| `docs/mcp-ui/draft-review/index.src.html`, `app.src.mjs` | The panel's page and script (the sources). |
| `docs/mcp-ui/draft-review/build.mjs` | Builds the sources into the generated file. |
| `app/api/mcp/route.ts` | Offers the panel on connections that have listing writing on. |

The sources live under `docs/` so the site's build does not try to compile them.

## Changing the panel

Edit `index.src.html` or `app.src.mjs`, then rebuild from the repo root:

```powershell
npm install --no-save esbuild @modelcontextprotocol/ext-apps@1.7.5
node docs/mcp-ui/draft-review/build.mjs
```

`--no-save` leaves `package.json` alone; the two packages are only needed to build.
Commit the regenerated `lib/mcp/ui/draft-review-html.ts` with the source change.

Photos load straight from photo storage, so the panel's sandbox is told to allow the
`R2_PUBLIC_BASE` origin (`photoOrigins()` in `review-panel-tools.ts`). If photos ever
move to another address, that function is where to add it.

## Removing the panel

In `app/api/mcp/route.ts`, take `reviewPanelTools(...)` out of the tools list and
set `resources` to `[]`. Claude then no longer sees the tool or the page. The other
files can stay or be deleted; nothing else uses them. No database changes were made.

## Tested how

`lib/mcp/protocol.test.mts` covers the protocol additions. The panel page was run in
headless Chrome inside a sandboxed frame against the SDK's own host bridge, with a
stand-in for FIA answering the tools (every button above, plus refresh and expand).
The first version was seen working on claude.ai; the PANEL-2 buttons had not yet been
used against real drafts when this was written.
