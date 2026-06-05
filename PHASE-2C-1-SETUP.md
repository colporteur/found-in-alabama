# Phase 2C-1 setup checklist

The foundation for Chrome-extension inventory capture. This phase adds:

- 3 new columns on the `items` table (haul_post_slug, sold_at, sold_on_marketplace)
- A working `/admin/api-keys` page where you generate the bearer token
  the extension uses
- `POST /api/admin/items/capture` — the endpoint the extension hits
- Public display: every haul post page now queries the DB for items
  linked to its slug and shows them in two groups (Still available /
  Recently sold) with a stats card

Phase 2C-2 (the extension itself) gets built next; 2C-1 has to ship
first because the extension needs a key to authenticate against.

## 1. Apply the migration

```powershell
robocopy "C:\Users\noren\AppData\Roaming\Claude\local-agent-mode-sessions\86389833-3e36-4674-9a52-65e418775700\1f05f1b8-1012-4f98-9d65-01e021d677a3\local_395f541e-88d6-4280-8df8-88ae82777303\outputs\found-in-alabama" "C:\Users\noren\found-in-alabama" /E /XD node_modules .next .git

cd C:\Users\noren\found-in-alabama
npm install
npm run db:generate
npm run db:migrate
```

Three columns get added to `items`. Existing data is untouched
(everything is nullable).

## 2. Push to production

```powershell
git add .
git commit -m "Phase 2C-1 — items haul-linking + API keys + public display"
git push
```

Vercel rebuilds (~60s). The `/admin/api-keys` page becomes functional
on production.

## 3. Generate your first key

1. Sign in at https://www.foundinalabama.com/admin
2. Click **API keys** in the admin nav
3. In the "New key" form, type a name (e.g. `Chrome on desktop`) →
   click **Generate key**
4. A green banner appears with the plaintext value (looks like
   `fia_AbC123...`). **This is the only time the full key is shown.**
5. Copy the value somewhere safe — you'll paste it into the Chrome
   extension in Phase 2C-2. For now, your password manager is fine.
6. Click "I've saved it — dismiss"

The key shows up in the table below with a prefix (`fia_AbC12345…`),
created date, and status (Active). You can revoke it later if you ever
want to.

## 4. Smoke-test the capture endpoint with curl

Before building the extension, confirm the endpoint actually works.
From PowerShell (replace `YOUR_KEY` with the plaintext from step 3):

```powershell
$body = @{
  filterMode = "listed"
  items = @(
    @{
      niftyId = "test-item-1"
      title = "Test capture item"
      status = "LISTED"
      privateNotes = "example-anniston-doctor-estate"
      marketplaces = @{
        eBay = @{ externalId = "1234567890"; status = "LISTED" }
        Etsy = @{ externalId = "9876543210"; status = "LISTED" }
      }
    }
  )
} | ConvertTo-Json -Depth 5

Invoke-WebRequest `
  -Method POST `
  -Uri "https://www.foundinalabama.com/api/admin/items/capture" `
  -Headers @{ "Authorization" = "Bearer YOUR_KEY" } `
  -ContentType "application/json" `
  -Body $body
```

Expected response (StatusCode 200):

```json
{
  "upserted": 1,
  "linkedToHaul": 1,
  "markedSold": 0,
  "errors": [],
  "keyName": "Chrome on desktop",
  "filterMode": "listed"
}
```

`linkedToHaul: 1` means it matched the slug `example-anniston-doctor-estate`
to your existing example haul post.

Now visit `https://www.foundinalabama.com/journal/example-anniston-doctor-estate`
— scroll past the narrative. You should see a "From this haul" section
with one item ("Test capture item") and a stats card showing "1 items
listed · 0 sold · 1 still available".

## 5. Clean up the test row (optional)

After the smoke test, you can leave the dummy row in the items table or
remove it. To remove it via admin UI: nothing yet — defer this to the
real Chrome extension flow which will overwrite or you can connect to
the DB directly.

For now, easiest cleanup is to either:
- Let it sit harmlessly with niftyId="test-item-1" (no real eBay link
  exists, the badges click to invalid URLs)
- Or, send another capture with the same `niftyId` but `status: "SOLD"`
  to flip it (still doesn't delete, just shows as sold)

Cleanup tooling can come later if it bothers you.

## What's next — Phase 2C-2

The Chrome extension:

- Manifest pointed at `app.nifty.ai/inventory*`
- Content script reads the page's React state via the technique we
  verified (walking `__reactFiber → memoizedProps.row.row`)
- Popup UI: "Found N items on this page (M with haul slugs)" + a
  **Sync to Found in Alabama** button
- Sends the batch to `POST /api/admin/items/capture` with the bearer
  token from step 3
- Shows the response counts

About a session and a half of focused work. Once it's installed you'll:

1. List items on Nifty as normal
2. Bulk-edit Private Notes on the new items to the haul slug
3. Click the extension button
4. New items appear on the haul page within seconds (and on production
   without redeploying)

For sold detection (same extension, just switch Nifty's filter to
"Sold"):
1. Open Sold view in Nifty
2. Click extension's Sync button
3. Newly-sold items get marked sold in the DB; haul pages show the
   "Recently sold" treatment with timestamp and marketplace attribution
