# Phase 2C-2 setup — install the Chrome extension

The capture endpoint (Phase 2C-1) is live. Phase 2C-2 is the Chrome
extension that makes it usable: a popup with a Sync button that walks
your current Nifty inventory page, captures every item's title +
marketplace links + private notes, and POSTs the batch to
`/api/admin/items/capture`.

## 1. Pull the new code

The `chrome-extension/` folder is already in your repo. Just sync:

```powershell
robocopy "C:\Users\noren\AppData\Roaming\Claude\local-agent-mode-sessions\86389833-3e36-4674-9a52-65e418775700\1f05f1b8-1012-4f98-9d65-01e021d677a3\local_395f541e-88d6-4280-8df8-88ae82777303\outputs\found-in-alabama" "C:\Users\noren\found-in-alabama" /E /XD node_modules .next .git

cd C:\Users\noren\found-in-alabama
```

You don't need to `npm install` or push anything — the extension is a
client-side install. But pushing keeps the source in your repo:

```powershell
git pull --rebase
git add chrome-extension/ PHASE-2C-2-SETUP.md
git commit -m "Phase 2C-2 — Chrome extension for Nifty inventory sync"
git push
```

## 2. Install the extension in Chrome

1. Open `chrome://extensions/`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select the folder `C:\Users\noren\found-in-alabama\chrome-extension`
5. The extension appears as "Found in Alabama — Nifty Sync"
6. Pin it (puzzle-piece icon in toolbar → pin)

## 3. Add your API key

1. Click the extension icon. Popup shows the Settings view.
2. Paste your `fia_...` key from
   https://www.foundinalabama.com/admin/api-keys
3. Leave Endpoint blank (defaults to production).
4. Click **Save**.

## 4. Do your first real sync

1. In Nifty, set the Private Notes on at least one item to a real
   published haul slug — e.g. `london-family-estate-anniston`. Use
   Nifty's bulk-edit if available.
2. Open `https://app.nifty.ai/inventory` (the Listed filter is fine).
3. Click the extension icon → **Sync this page**.
4. ~5 seconds later you'll see a success card with three counts:
   captured / linked / sold.
5. Open `https://www.foundinalabama.com/journal/london-family-estate-anniston`
   — scroll past the narrative. The "From this haul" section now shows
   stats + the items you just tagged.

## 5. Sold detection — same flow, different filter

When you want to refresh the sold-items count (say, weekly):

1. Switch Nifty to the **Sold** filter
2. Click the extension icon → **Sync this page**
3. Items found in the sold view get `status: sold`, with
   Nifty's own `soldAt` timestamp and the marketplace they sold on.
4. Haul pages now show those items in the "Recently sold" section with
   "Sold on eBay · June 5" style attribution.

## 6. Pagination note

The extension only syncs items currently visible in the React state on
the page — i.e. one page of results at a time (~16 items per page by
default in Nifty). If you have a recent haul with more items than fit
on one page:

- Click through each page of the Listed filter
- Click Sync once per page
- Items dedupe by Nifty id on the server, so re-syncing the same page
  is harmless

A future tweak could auto-page through, but for now manual paging keeps
the extension dumb and reliable.

## Troubleshooting

- **Settings won't open** — the popup defaults to Settings when no API
  key is saved. After saving, the footer has a Settings link to come
  back.
- **"Could not run scraper"** — you're probably not on
  `app.nifty.ai/inventory*`. Check the URL.
- **"Found no items"** — Nifty's grid hadn't finished loading.
  Scroll once, then re-click Sync.
- **HTTP 401** — your key was revoked. Open
  /admin/api-keys, generate a new one, paste into Settings.
- **HTTP 502 / network error** — Vercel is rebuilding or down. Wait a
  minute.
- **Wrong items captured** — switching tabs or scrolling while sync
  runs can confuse it. Wait until the success card appears before
  doing anything else.

## After this — what's left in Phase 2

- Polish: bulk pagination (one click syncs all listed pages), better
  error handling, a real icon set
- Phase 2D — periodic sold-detection reminder (Vercel cron emails
  you weekly: "time to switch to the Sold filter and run sync")
- Phase 2E — migrate journal posts from markdown to DB so you can
  edit existing posts in the dashboard

But the core loop (list on Nifty → tag with haul slug → click extension
Sync → items live on the haul page) is now complete.
