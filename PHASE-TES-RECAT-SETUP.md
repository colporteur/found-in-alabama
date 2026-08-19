# Phase TES-RECAT setup checklist — storefront recategorize queue

What's new: while browsing theephemeralstate.com you can flag any product
card as miscategorized (small ⇄ button, top-right of the photo on hover).
A panel shows the item's two eBay Store Category slots; mark which are
wrong and either pick the replacement yourself or let the AI categorizer
choose (same one the admin tool uses — `fia-cheap` gateway alias, no new
alias needed). Flags land in a new `tes_recat_queue` table, and the
Chrome extension's actuator applies the change **in Nifty** — search →
item drawer → eBay section → Store categories popover — so "Recreate"
can't revert it. On success the site's local eBay mirror is updated
immediately too.

Everything below was already applied to your working folder by Cowork.
Your part: migrate, deploy, reload the extension, test on one item.

## 1. What changed (for your review)

**Site (found-in-alabama repo):**
- **Schema:** new `tes_recat_queue` table (old/new category id per slot,
  mode manual/ai/mixed, AI confidence + reasoning, status
  pending/done/manual/failed).
- **New API routes** (all Bearer-key auth, same keys as /admin/api-keys):
  - `GET /api/tes/recat-queue/meta?itemId=…` — item's current slots +
    leaf-category list for the overlay's picker.
  - `POST /api/tes/recat-queue` — enqueue a flag. AI slots are resolved
    server-side at enqueue time via `suggestCategoryForListing`, so the
    queue always stores concrete category ids. Rejects duplicates (409),
    "AI agrees with current" (422), and no-op changes.
  - `GET /api/tes/recat-queue` — pending work for the actuator, with
    remove/add as full paths in Nifty's format ("Parent > Child").
  - `POST /api/tes/recat-queue/complete` — outcome per entry; `done`
    also updates `ebay_listings.store_category_1_id/2_id` locally.

**Extension (`chrome-extension-tes-delist/`, v0.2.1 → v0.3.0, renamed
"TES Actuator"):**
- `overlay.js` + `overlay.css` (new) — the storefront button + panel.
  Runs on theephemeralstate.com and foundinalabama.com/tes.
- `background.js` — polls BOTH queues on the same alarm; proxies the
  overlay's API calls (content scripts can't cross-origin in MV3).
- `content.js` — new `recatItem` actuator: row by unique title → SKU
  check → drawer → eBay section → Store categories popover → remove
  wrong chips FIRST (never exceeds eBay's 2-cap), add replacements via
  search, close, click any Save/Update that appears, verify the field
  text shows the new set.
- Popup title + run summary now cover both queues.

## 2. Migrate the database

```powershell
cd C:\Users\noren\found-in-alabama
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
npm run db:generate   # emits CREATE TABLE tes_recat_queue
npm run db:migrate    # applies to prod Postgres (Neon)
```

## 3. Deploy

```powershell
git add -A
git commit -m "Phase TES-RECAT — storefront recategorize queue + extension actuator"
git pull --rebase
git push
```

## 4. Reload the extension

`chrome://extensions` → TES Actuator → Reload (version should read
0.3.0). The saved API key and poll interval carry over. Chrome will ask
to approve the new theephemeralstate.com host permission.

## 5. Test on ONE sacrificial item

1. Browse a category on theephemeralstate.com → hover a card → click ⇄.
2. Flag one slot, use **"I'll pick"** first (deterministic), pick some
   category, Queue.
3. Extension popup → **Run now**. Watch the Nifty tab it drives: drawer
   opens → eBay section → popover edits → verify.
4. Check the popup log line (`RECAT DONE: …`) and the item in Nifty —
   the Store categories field should show the new set.
5. **Watch for a save/update prompt in Nifty we haven't seen:** the
   actuator clicks any visible Save/Update button after closing the
   popover, but if Nifty needs something else the run ends `failed` with
   a note — tell Cowork what the screen showed and we'll teach the
   actuator that step.
6. Then try an AI flag: the panel shows the AI's pick + reasoning the
   moment it's queued (before any Nifty action).

## 6. Known behaviors & edges

- **One pending flag per item** — flagging again while queued shows
  "Already queued". Failed rows are NOT retried automatically; flag the
  item again after fixing the cause.
- **Ambiguous titles** (2+ rows match in Nifty search) → `manual`, same
  rule as delists.
- **AI can refuse**: if it thinks the current category is right, or
  nothing fits, the flag is rejected with its reasoning — nothing queues.
- **eBay's own sync**: the site mirror updates on `done`; the next full
  listings sync from eBay will confirm once Nifty pushes the revision.
  If eBay shows the old category days later, Nifty never pushed — check
  the item in Nifty.
- The drawer-opening click has fallbacks (title first, then the row's
  trailing action buttons). If a run logs `manual — Could not open the
  item drawer`, note which button visually opens the drawer for you and
  we'll pin the selector.

## What's next (not in this phase)

- Admin page listing pending/failed recat rows (popup log covers v1)
- Batch flag from the site's category grid ("all of these are wrong")
- Auto-retry failed rows with backoff
