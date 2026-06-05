# Found in Alabama — Nifty Sync (Chrome extension)

A small unpacked Chrome extension that captures items from your Nifty.ai
inventory page and links them to the matching haul post on
foundinalabama.com.

## Install (unpacked)

1. Open Chrome → `chrome://extensions/`
2. Toggle **Developer mode** on (top-right corner)
3. Click **Load unpacked**
4. Select this folder (`chrome-extension/` from the repo)

The extension appears in your toolbar. Pin it for quick access (puzzle
icon → pin "Found in Alabama").

## First-time setup

1. Click the extension icon. The popup shows the Settings view because
   no API key is saved yet.
2. Paste your API key from
   https://www.foundinalabama.com/admin/api-keys (it looks like
   `fia_AbC123…`).
3. Leave the Endpoint blank to target production. Set it to
   `http://localhost:3000` if you're testing against a local dev server.
4. Click **Save**.

## Day-to-day use

1. After listing new items on Nifty, set each item's **Private notes**
   to the slug of the haul post they belong to (e.g.
   `london-family-estate-anniston`). Bulk-edit notes via Nifty's row
   selection if that's available, otherwise per-item.
2. Visit `https://app.nifty.ai/inventory` (any filter view works —
   Listed for new items, Sold for newly-sold items).
3. Click the extension icon → **Sync this page**.
4. Wait a few seconds. You'll see counts: how many items were captured,
   how many got linked to a haul, how many were marked sold.
5. Open the haul post on foundinalabama.com to see the items render
   below the narrative.

## How it works

- Reads each row's React state directly (via `__reactFiber → memoizedProps`)
  to get item id, title, private notes, marketplace metadata. No DOM
  scraping.
- Sends a JSON batch to `/api/admin/items/capture` with bearer auth.
- The server matches `privateNotes` against published post slugs;
  matched items get `haul_post_slug` set, unmatched items still get
  captured but stay unassigned.
- Sold-view items get `status: sold`, `soldAt` from Nifty's own
  timestamp, and `soldOnMarketplace` derived from which platform shows
  `status: SOLD` in the metadata.

## Icons

Drop your Found in Alabama logo into `icons/` at three sizes — 16, 48,
and 128 px PNGs named `16.png`, `48.png`, `128.png`. If the folder is
empty, Chrome uses a default puzzle-piece icon.

Quick way to make them: take your existing yellow-Alabama logo, open
https://squoosh.app, resize, save three copies.

## Troubleshooting

- **"Could not run scraper"** — make sure you're on a Nifty inventory
  URL (`/inventory?...`). Other Nifty pages have different DOM.
- **"Found no items on the page"** — Nifty's grid hadn't finished
  loading. Scroll the page once and re-click Sync.
- **HTTP 401 from the API** — your key was revoked or you mistyped it.
  Go to Settings (footer link), paste a fresh key from
  /admin/api-keys.
- **HTTP 502 / network error** — Vercel deploy in progress or the API
  is down. Try again in a minute.

## Updating the extension

The unpacked install reloads from disk every time you click the
reload-arrow on the extensions page. After pulling new code:

1. `chrome://extensions/`
2. Find "Found in Alabama — Nifty Sync"
3. Click the reload arrow (↻)
4. Done — next click of the extension uses the new code.
