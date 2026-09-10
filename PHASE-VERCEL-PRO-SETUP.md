# Vercel Pro + storefront caching — setup checklist (2026-09-10)

Why: Fluid Active CPU hit 6h19m against Hobby's 4h. 99.7% was
found-in-alabama, and Observability showed the sink was crawlers
rendering ~7,000 `force-dynamic` storefront pages — not the crons. Usage
stepped up the day TES launched (Aug 17) and never came back down; the
ESE sweep was a ~8-minute bump on top.

Two changes, already written into your working folder by Cowork:

1. **Storefront pages are ISR-cached (10 min) with on-demand purges.**
   `tesPrefix()` no longer reads request headers (that one call forced
   every TES page dynamic). The `/tes/*` preview path on
   foundinalabama.com now 301s to theephemeralstate.com.
2. **All cron heartbeats move from GitHub Actions to Vercel Cron**
   (`vercel.json`), which Pro allows at any cadence.

Files touched: `vercel.json`, `middleware.ts`, `lib/tes/host.ts`,
`lib/storefront-cache.ts` (new), `lib/ebay/events-sync.ts`,
`lib/ebay/listing-sync.ts`, `app/api/cron/categorize/route.ts`,
`app/api/cron/sync-listings/route.ts` (comment only),
`app/api/admin/tes-discount/route.ts`, `app/api/admin/tes-featured/route.ts`,
and the eight storefront pages under `app/(fia)` and `app/(tes)`.

## 1. Vercel plan

Upgrade the team to Pro (you were doing this). Nothing in the code
depends on it EXCEPT the sub-daily cron schedules in `vercel.json` —
on Hobby the deploy would be rejected for those.

## 2. The GitHub workflow files (Cowork could not write these)

`.github/workflows/*.yml` is a protected path for the desktop bridge.
The five updated files are attached in the chat (schedule removed,
`workflow_dispatch` kept for manual runs, note at the top). Either:

- copy them over `.github\workflows\` in the repo, **or**
- leave the files and disable each workflow in GitHub → Actions →
  (workflow) → `···` → **Disable workflow**. Copying the files is
  better: a disabled workflow silently re-arms if someone edits it.

Do this in the SAME commit as the vercel.json change, otherwise both
schedulers hit the endpoints for a while (harmless — every endpoint is
idempotent — but it doubles the cron CPU).

## 3. Deploy

```powershell
cd C:\Users\noren\found-in-alabama
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
git add -A
git commit -m "Vercel Pro: storefront ISR + on-demand purge; crons move from GitHub Actions to Vercel Cron"
git pull --rebase
git push
```

Watch the build. Two things can only be proven by the build:

- `revalidate = 600` on `/`, `/shop`, `/tes`, `/tes/states`, `/tes/types`
  means Next prerenders those at BUILD time, so the build now needs the
  database (it did before `force-dynamic` was added, per the comment in
  `app/(fia)/page.tsx`, so this should be fine). If the build fails on a
  DB connection, tell Cowork — the fix is one line per page.
- `next build` will flag any storefront page that still ends up dynamic
  (it prints `ƒ` vs `○`/`●` per route in the build summary). Every
  storefront route above should show as ISR, not `ƒ`.

## 4. Verify (5 minutes)

1. Vercel → project → Settings → **Cron Jobs**: six entries listed,
   matching `vercel.json`. Click "Run" on `sync-events` once and check
   the log line `[sync-events] {...}` appears (that proves CRON_SECRET
   auth works from Vercel's own scheduler).
2. `https://www.foundinalabama.com/tes/shop/postcards` → should 301 to
   `https://theephemeralstate.com/shop/postcards`.
3. Open any TES item page twice; the response header `x-vercel-cache`
   should read `MISS` then `HIT` (DevTools → Network → the document).
4. Buy-path sanity: cart → checkout still works (those pages stayed
   dynamic).
5. Change the TES discount at /admin/tes-featured, reload the TES home:
   the banner updates immediately (on-demand purge working).
6. Tomorrow: Usage → Fluid Active CPU. Expect the daily bar to fall
   back toward the pre-Aug-17 level (3–5 min/day) as the CDN absorbs the
   crawlers. Anything still above ~8 min/day means a page is still
   rendering per request — send Cowork the Observability Functions table.

## Notes for later

- The `hip-sales` / `hip-map` cron routes are NOT scheduled yet (HIP API
  key still pending). When it lands, add them to `vercel.json`.
- `robots.txt` still blocks the SEO-tool scrapers. Keep that; with ISR
  they'd only cost CDN bandwidth, but there's no reason to feed them.
- If a sold item ever lingers on the storefront longer than 15 minutes,
  the sync-events cron log is the first place to look — the purge is
  tied to its `updated > 0` path.
