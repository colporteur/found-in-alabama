# Phase TES-1 setup checklist — The Ephemeral State catalog v1

What's new: theephemeralstate.com now lives inside this codebase as a
second site. Middleware routes by hostname; TES gets its own root layout,
kraft-paper branding, and a catalog filtered to the store categories you
flag as "Ephemeral". Buy buttons link to eBay — no checkout yet (that's a
later phase, along with the Nifty delist queue).

Everything below was already applied to your working folder by Cowork
(including moving the FIA pages into `app/(fia)/` — a route group; public
URLs do not change). Your part is: migrate, test, flag categories, deploy,
then connect the domain.

## 1. What changed in the repo (for your review)

- **Moved:** all FIA pages from `app/*` into `app/(fia)/*` (route group —
  URLs unchanged). `app/layout.tsx` became `app/(fia)/layout.tsx`; only its
  globals.css import path changed. `app/api/*`, `globals.css`, and
  `manifest.ts` did not move.
- **New site:** `app/(tes)/` — its own root layout + home page +
  `/tes/shop/[category]` grid; `components/tes/` (Header, Footer,
  ItemCard); `lib/tes/host.ts` (link-prefix helper).
- **Middleware:** now matches all non-API, non-static routes. On TES
  hostnames it rewrites `/` → `/tes`, `/shop/x` → `/tes/shop/x`. Admin
  auth gating is unchanged.
- **Schema:** `ebay_store_categories.is_ephemeral_state` boolean + index.
  Flag a parent ("Found in Other States") and all its children count.
  Re-syncs preserve the flag, same as the Alabama flag.
- **Admin:** `/admin/ebay/categories` has a third toggle column
  ("Ephemeral"), an `ephemeral` filter chip, and a count stat.
- **Tailwind:** new `tes-*` colors + `font-typewriter` (Special Elite).

## 2. Migrate the database

```powershell
cd C:\Users\noren\found-in-alabama
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
npm run db:generate   # emits the ALTER TABLE for is_ephemeral_state
npm run db:migrate    # applies to prod Postgres (Neon)
```

## 3. Drop in the logo

Save the final logo PNG (transparent background version if you have one) at:

```
C:\Users\noren\found-in-alabama\public\tes\logo.png
```

The TES header renders it at ~80–96px tall next to a text wordmark, so a
crop without huge margins looks best. (Favicon/simplified variant can wait.)

## 4. Test locally

```powershell
npm run dev
```

1. `http://localhost:3000` — FIA home should look exactly as before
   (header, footer, shop, journal, admin all unchanged).
2. `http://localhost:3000/admin/ebay/categories` — flag your ephemera
   categories: flip "Ephemeral" ON for the **Found in Other States**
   parent (children ride along automatically) and each ephemera /
   ephemera-adjacent category you want on the new site.
3. `http://localhost:3000/tes` — TES home: kraft hero + only the flagged
   categories. Click into a category; items should link to eBay.
4. Optional clean-URL test: `http://tes.localhost:3000` serves TES at the
   root with no `/tes` in the URL (middleware host rewrite). Most
   browsers resolve `*.localhost` automatically.

## 5. Deploy

```powershell
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
git add -A
git commit -m "Phase TES-1 — The Ephemeral State catalog (second domain, category flags)"
git pull --rebase
git push
```

`git add -A` matters this time — it needs to record the `app/(fia)/` moves
as renames plus the new `(tes)` files.

## 6. Connect the domain (after the deploy is green)

**Vercel** (project → Settings → Domains):
1. Add `theephemeralstate.com` and `www.theephemeralstate.com`.
2. Set `www` → redirect to the apex (Vercel offers this when both exist).

**Cloudflare** (theephemeralstate.com zone → DNS):
1. Add a CNAME record: name `@`, target `cname.vercel-dns.com`
   (Cloudflare flattens it at the apex automatically).
2. Add a CNAME record: name `www`, target `cname.vercel-dns.com`.
3. Set both to **DNS only** (grey cloud, proxy OFF) — Vercel terminates
   TLS itself; proxying through Cloudflare causes cert/redirect fights.

Then visit `https://theephemeralstate.com` — you should see the TES home
with clean URLs (`/shop/…`, no `/tes` visible). foundinalabama.com/tes
keeps working as a preview path.

## 7. If anything breaks

- **Build error about two root layouts / html tags** — something is still
  at `app/layout.tsx`. It must not exist; only `app/(fia)/layout.tsx` and
  `app/(tes)/layout.tsx`.
- **FIA pages 404** — a folder didn't make it into `app/(fia)/`. Compare
  `ls app` (should be just `(fia)`, `(tes)`, `api`, `globals.css`,
  `manifest.ts`) and move strays in.
- **TES shows every category** — the segment filter falls back to nothing
  flagged? No: unflagged = empty TES home. "Every category" means the page
  is hitting the FIA route — check the URL has `/tes` (or the TES host).
- **TES home is empty after flagging** — flagged categories only show
  with in-stock items whose store-category slots point at them (same rule
  as the FIA shop). Check a flagged category actually has active listings.
- **Domain shows FIA site** — middleware host list covers apex + www; if
  you added a different subdomain, add it to `isTesHost()` in
  `middleware.ts` and `lib/tes/host.ts`.
- **Known cosmetic:** the PWA manifest (`app/manifest.ts`) is still
  FIA-branded on both hosts; harmless, will split in a later phase.

## What's next (not in this phase)

- Vector/favicon logo variants; TES-specific OG image
- SEO polish (sitemap, per-state landing copy)
- Phase 2: Stripe checkout + the delist queue + Chrome-extension actuator
  (recon notes from the Nifty experiment cleanup feed this)
