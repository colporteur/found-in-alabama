# Phase eBay-1.1 setup checklist

The auto-categorize refactor. Replaces the manual review/approve queue
with a one-button flow that pulls live Other-only listings, asks Claude
for a categorization, and pushes ReviseItem to eBay — no per-item
approval.

## What changed (vs. the old Phase eBay-1)

- `/admin/ebay/review` and `/admin/ebay/pull` are gone (auto-redirect to
  the new tool if you have bookmarks).
- `/admin/ebay/auto-categorize` is the new home — one button per phase,
  live progress bar, results table that fills in as items get processed.
- No persistent listings cache. Each run snapshots a fresh list of
  eligible items from eBay, processes them, and discards the snapshot.
  Solves the "item sold mid-cache" problem you were hitting.
- Old run rows are deleted at the start of each new run so the page
  always shows just the current activity. No long-term history.

## Apply the upgrade

```powershell
# 1. Pull the new code into your working folder
robocopy "C:\Users\noren\AppData\Roaming\Claude\local-agent-mode-sessions\86389833-3e36-4674-9a52-65e418775700\1f05f1b8-1012-4f98-9d65-01e021d677a3\local_395f541e-88d6-4280-8df8-88ae82777303\outputs\found-in-alabama" "C:\Users\noren\found-in-alabama" /E /XD node_modules .next .git

# 2. Run the migration (adds two new tables)
cd C:\Users\noren\found-in-alabama
npm run db:generate
npm run db:migrate

# 3. Restart dev
npm run dev
```

No new env vars. No new dependencies (uses the same `@anthropic-ai/sdk`
and Trading API client already installed).

## Use it

1. `http://localhost:3000/admin/ebay/auto-categorize`
2. Pick **Primary** (move out of Other) — Secondary is locked until
   Primary completes
3. Click **Start primary run**
4. Wait 10–30 seconds while the queue snapshots from eBay
5. Watch the table fill in. ~1 item every 2 seconds. For 247 items
   expect ~10 minutes total.
6. Stop button cancels mid-run if you spot a pattern of bad calls.

## What happens to items the tool can't handle

- **Already sold / ended** — eBay rejects ReviseItem with an "ended"
  error. The row gets logged with outcome `ebay_ended` and the run moves
  on. No retry.
- **Claude can't find a confident match** — row gets logged with
  outcome `skipped`. You can re-run later if you add more relevant
  categories on eBay.
- **eBay rejects for another reason** (auth expired, schema error,
  etc.) — row gets logged with outcome `ebay_failed` and the error
  message is captured. If a few in a row fail, hit Stop and check the
  error.

## Push to production

```powershell
git add .
git commit -m "Phase eBay-1.1 — auto-categorize refactor"
git push
```

Vercel auto-rebuilds. The new tool will be available at
`https://www.foundinalabama.com/admin/ebay/auto-categorize` after the
deploy completes.

## What's still here from old Phase eBay-1

- `/admin/ebay/categories` — Store category sync. Still works. You should
  run it any time you add or rename categories on eBay so Claude's
  options stay current.
- `/admin/ebay/connect` — connection test. Useful for diagnosing whether
  your Auth'n'Auth user token is still valid.
- `/admin/ebay/sales` — Phase 2 sales tool. Still paused due to eBay
  Marketing API issues.

## Files that became dead code (not used, but not deleted)

- `app/admin/ebay/review/ReviewQueue.tsx`
- `app/admin/ebay/pull/PullListingsCard.tsx`
- `app/api/admin/ebay/suggestions/generate-next/route.ts`
- `app/api/admin/ebay/suggestions/decide/route.ts`
- `app/api/admin/ebay/pull-listings/route.ts`
- The `ebay_listings` and `ebay_category_suggestions` tables in Postgres

Safe to leave them. If you want a clean repo you can delete the files
manually, but they don't cost anything sitting there.
