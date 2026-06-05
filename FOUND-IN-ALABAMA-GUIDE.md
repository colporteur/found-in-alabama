# Found in Alabama — master guide

The single source of truth for what's built, how to use it, and how to
keep it running. Phase-specific setup docs are referenced inline.

## Table of contents

1. What's built right now
2. Architecture in one paragraph
3. Day-to-day usage — public site
4. Day-to-day usage — admin: writing journal posts
5. Day-to-day usage — admin: eBay re-categorization
6. Day-to-day usage — admin: eBay sales (currently paused)
7. First-time setup sequence (new machine or fresh checkout)
8. Phase setup checklists (pointers)
9. Operational tasks (env rotation, token refresh, deploys)
10. Troubleshooting
11. What's next

---

## 1. What's built right now

| Area | Status | URL |
|------|--------|-----|
| Public marketing site | Live | foundinalabama.com |
| About / We Buy / Find me / Contact | Live | foundinalabama.com/{about,we-buy,find-me,contact} |
| Journal (markdown-based) | Live | foundinalabama.com/journal |
| Admin sign-in (magic link via Resend) | Live | foundinalabama.com/admin |
| Claude API draft generator | Live | foundinalabama.com/admin/draft |
| eBay re-categorization tool | Live | foundinalabama.com/admin/ebay |
| eBay sales/promotions tool | Built, **paused** — see §6 | foundinalabama.com/admin/ebay/sales |
| Chrome extension (Nifty capture) | Not built | — |
| Customer newsletter (Phase eBay-3) | Not built | — |

Three places hold credentials:

- **Vercel project Environment Variables** — what production reads at
  runtime. Sensitive values (any AUTH_*, ANTHROPIC_API_KEY, EBAY_*
  secrets) are encrypted; `vercel env pull` brings them down empty for
  local use.
- **`C:\Users\noren\found-in-alabama\.env.local`** — what local dev
  reads. You paste real values here manually when Vercel returns empty
  due to the Sensitive flag.
- **Vercel Postgres (Neon)** — runtime database. Single database serves
  both local dev and production (no preview branching).

## 2. Architecture in one paragraph

Next.js 14 App Router with Tailwind, deployed to Vercel. Auth.js v5
provides admin sign-in via Resend email magic links, with sessions in
JWT cookies and a Drizzle/Postgres adapter for the verification token
table. The public site is mostly static (server components with no DB
dependency). The journal currently lives as markdown files in
`content/posts/` parsed at request time. The admin dashboard depends on
Postgres for inventory, eBay caches, and sales records. eBay
integration uses two parallel auth chains: an Auth'n'Auth user token
for the Trading API (re-categorization) and OAuth refresh tokens for
the Sell APIs (sales). Claude API is called server-side from
`/api/admin/draft` and from the eBay categorization route.

## 3. Day-to-day usage — public site

The public site is mostly evergreen. Day-to-day work:

- **Add a journal post** — see §4 below.
- **Update the We Buy page** — `app/we-buy/page.tsx`. Edit, commit,
  push.
- **Update the Find me marketplace cards** — `lib/links.ts`. Single
  source for header, footer, and the Find me page.
- **Update the home page copy or tagline** — `app/page.tsx`.

Any push to `main` triggers a Vercel rebuild within ~60s.

## 4. Day-to-day usage — admin: writing journal posts

Two paths, depending on whether you want AI to draft for you:

### 4a. Generate a draft with Claude (recommended for hauls)

1. Sign in at foundinalabama.com/admin
2. Click **Draft a haul** in the admin nav
3. Upload your hero photo (JPG/PNG/WebP, ~2000px on the long edge is
   fine — Claude resizes for vision)
4. Type 2–4 sentences of context — where the haul came from, what
   kinds of items, anything notable
5. Click **Generate draft with Claude**. Wait 5–15 seconds.
6. Edit the four returned fields (Title / Slug / Excerpt / Body) until
   they sound like you
7. Click **Copy as markdown**. A complete .md file (frontmatter + body)
   is on your clipboard.
8. Create a new file at `content/posts/{your-slug}.md` in your project
   folder and paste
9. Save the hero photo at `public/photos/posts/{your-slug}-hero.jpg`
10. `git add . && git commit -m "Add post: {slug}" && git push`

Vercel rebuilds and the post appears at
`/journal/{your-slug}` within ~60s.

Cost per generation: about $0.02 with Claude Sonnet. Your $5–10
balance covers hundreds.

### 4b. Write by hand (for live-sale or travel posts, or short hauls)

Hand-edit a new file in `content/posts/`. Three templates exist as
example files — `example-anniston-doctor-estate.md` (haul),
`example-whatnot-live-show.md` (live sale),
`example-mobile-picker-trip.md` (travel). Copy whichever fits, rename
to your own slug, edit, push.

Full field reference for each post type lives in
`content/posts/README.md`.

## 5. Day-to-day usage — admin: eBay re-categorization

Pulls every active listing whose Store Category 1 is "Other" and
Store Category 2 is empty, asks Claude for better-fitting Store
categories (with extra weight on Alabama-related ones), then pushes
approved changes back to eBay.

1. Sign in at foundinalabama.com/admin → **eBay tools**
2. **Step 1 — Sync store categories.** Reads your full Store
   category tree from eBay. Auto-flags categories that look
   Alabama-related (toggle these on/off if you disagree). Do this
   anytime you add or rename Store categories on eBay.
3. **Step 2 — Pull listings to recategorize.** Pulls listings
   matching the filter (Other + empty cat 2) into the local cache.
   Re-run periodically to pick up newly-listed items.
4. **Step 3 — Review & approve suggestions.** Each cached listing
   gets a Claude suggestion with confidence and reasoning. High
   confidence auto-applies and pushes to eBay; rest go into a review
   queue you walk one at a time. Reject, edit, or accept each.
5. **Step 4 — History.** Audit log of every change pushed to eBay,
   with the reasoning Claude gave at the time. Use to undo if needed.

Token rotation: the long-lived `EBAY_AUTH_TOKEN` lasts ~18 months.
Calendar reminder 30 days before expiry. When it expires, listings
fail with error code 21916984 — fix by repeating
`PHASE-EBAY-1-SETUP.md` step 2 and pasting the new token.

## 6. Day-to-day usage — admin: eBay sales (currently paused)

The full OAuth flow, Sell Marketing API client, sale-creation UI, and
audit log were built and shipped. **eBay's Marketing API has been
returning an opaque "Internal error" on every markdown-create attempt
since 2026-04.** The Seller Hub UI works fine — recommended use:

- Schedule sales in
  [eBay Seller Hub → Marketing](https://www.ebay.com/sh/marketing)
- Use this tool's audit log to record what you did manually if you
  want a local mirror

If eBay later resolves the API issue, the code is ready to flip back
on. To check whether it's working now:

1. /admin/ebay/sales/connect → verify "Connected" badge
2. /admin/ebay/sales/new → fill in a test sale → submit
3. If submission returns FAILED with "Internal error", same issue
4. If it returns DRAFT, SCHEDULED, or RUNNING, the API is back —
   tell the codebase maintainer.

## 7. First-time setup sequence (new machine or fresh checkout)

Walk through these once when bootstrapping. Subsequent days, just
`npm run dev` from your existing checkout.

1. **Clone the repo.** `git clone https://github.com/colporteur/found-in-alabama.git C:\Users\noren\found-in-alabama` (avoid deep AppData paths — Windows long-path limits will bite later).
2. **Install Node 22.** https://nodejs.org → LTS installer. Skip the
   native-build-tools checkbox.
3. **Vercel CLI + link.** In the project folder:
   ```powershell
   npm install -g vercel
   vercel link        # follow prompts; pick colporteurs-projects/found-in-alabama
   vercel env pull --environment=production .env.local
   ```
4. **Paste real values for Sensitive env vars.** Open `.env.local` in
   Notepad and fill in everything that came down empty:
   - `AUTH_SECRET` — generate at https://generate-secret.vercel.app/32
   - `AUTH_RESEND_KEY` — from https://resend.com/api-keys (revoke and
     recreate if you didn't save the original)
   - `AUTH_EMAIL_FROM` — `Found in Alabama <hello@foundinalabama.com>`
   - `AUTH_URL` — `http://localhost:3000` (for local dev only;
     production env in Vercel stays as `https://www.foundinalabama.com`)
   - `ADMIN_EMAIL` — `colporteurbooks@gmail.com`
   - `ANTHROPIC_API_KEY` — from https://console.anthropic.com → API keys
   - `EBAY_APP_ID`, `EBAY_DEV_ID`, `EBAY_CERT_ID`, `EBAY_AUTH_TOKEN`
     — from https://developer.ebay.com → My Account
   - `EBAY_RU_NAME`, `EBAY_OAUTH_REDIRECT_URI`,
     `EBAY_OAUTH_STATE_SECRET` — see `PHASE-EBAY-2-SETUP.md` step 1
5. **Install dependencies + run migrations:**
   ```powershell
   cd C:\Users\noren\found-in-alabama
   npm install
   npm run db:generate
   npm run db:migrate
   ```
6. **Start the dev server:**
   ```powershell
   npm run dev
   ```
   Should land on `http://localhost:3000`. Open `/admin`, sign in,
   verify dashboard.

## 8. Phase setup checklists (pointers)

The detailed step-by-step setup docs for each phase:

- `PHASE-2A-SETUP.md` — auth + database + admin shell (Resend, Neon,
  AUTH_* env vars)
- `PHASE-2B-SETUP.md` — Claude API draft generator (Anthropic key)
- `PHASE-EBAY-1-SETUP.md` — Trading API re-categorization (eBay
  Auth'n'Auth token)
- `PHASE-EBAY-2-SETUP.md` — Sell APIs sales (OAuth RuName + state
  secret)

Each is self-contained — work top-to-bottom and you'll have that
phase running.

## 9. Operational tasks

- **Deploy code changes.** `git push` from `C:\Users\noren\found-in-alabama`. Vercel auto-rebuilds.
- **Sync scratch → working folder.** If new code lives only in
  Claude's scratch path, robocopy it:
  ```powershell
  robocopy "C:\Users\noren\AppData\Roaming\Claude\local-agent-mode-sessions\86389833-3e36-4674-9a52-65e418775700\1f05f1b8-1012-4f98-9d65-01e021d677a3\local_395f541e-88d6-4280-8df8-88ae82777303\outputs\found-in-alabama" "C:\Users\noren\found-in-alabama" /E /XD node_modules .next .git
  ```
- **Rotate the Resend API key.** New key at resend.com/api-keys →
  paste into `.env.local` AND update in Vercel env vars → redeploy.
- **Rotate the eBay Auth'n'Auth token (~18 months).** See
  `PHASE-EBAY-1-SETUP.md` step 2. Update both `.env.local` and Vercel.
- **Rotate Anthropic API key.** New key in console.anthropic.com →
  same update-both-places dance.
- **Reset everything.** Delete `.env`, `.env.local`, `node_modules`,
  `.next`. Re-run `vercel env pull --environment=production .env.local`
  and re-paste sensitive values. `npm install`, `npm run db:migrate`,
  `npm run dev`. Database itself is untouched.

## 10. Troubleshooting

### Sign-in returns "Server error / There is a problem with the server configuration"

Switch to the PowerShell window running `npm run dev` — the real error
prints there. Common causes (in order of likelihood):

- **`AUTH_RESEND_KEY` is empty in `.env.local`.** Sensitive flag means
  `vercel env pull` brought it down blank. Paste the `re_...` value
  manually, restart dev.
- **`AUTH_SECRET` is empty.** Same issue. Generate one at
  generate-secret.vercel.app/32, paste, restart.
- **`UntrustedHost: Host must be trusted`.** Already patched —
  `auth.config.ts` has `trustHost: true`. If you see this, you have an
  outdated `auth.config.ts`. Robocopy from scratch.
- **Magic link redirects to `/signin` instead of `/admin`.** Already
  patched — `app/signin/page.tsx` sets `callbackUrl` in FormData. If
  you see this, robocopy.

### Dev server lands on port 3001 instead of 3000

Port 3000 is in use. Kill all node processes:
```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5
```

Then `npm run dev` again. If it still goes to 3001, find what's
holding 3000:
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess
```

### `npm run db:migrate` says POSTGRES_URL not set

Run `vercel env pull --environment=production .env.local` again — the
Vercel CLI link might have stale state. Then retry.

### eBay Trading API returns "Invalid token"

The `EBAY_AUTH_TOKEN` either expired, was for sandbox not production,
or has a stray newline. Regenerate per `PHASE-EBAY-1-SETUP.md` step 2.

### eBay Sell Marketing API returns "Internal error"

Known issue, see §6. Use Seller Hub UI instead until eBay fixes it.

### Production /admin works but local /admin doesn't (or vice versa)

The `.env.local` values for `AUTH_URL` differ between the two
environments. Local must be `http://localhost:3000`; Vercel must be
`https://www.foundinalabama.com`.

### Sign-in worked yesterday, broken today

Magic-link verification tokens expire in 24 hours. If you clicked a
day-old link, generate a fresh one.

### Page rendering looks broken / unstyled

Tailwind didn't recompile after a code change. Ctrl+C the dev server,
delete the `.next` folder, restart with `npm run dev`. First request
will be slow as Next rebuilds.

### "Module not found" errors after pulling new code

New dependencies are in `package.json` but not installed locally. Run
`npm install`.

## 11. What's next

Roughly in priority order:

- **eBay Phase 3 — customer newsletter.** Pull recent buyers from the
  Sell API, group by item categories purchased, send a "what's new in
  your category" email via Resend. Cadence: monthly. Estimated build:
  1 session.
- **Chrome extension for Nifty inventory capture.** Captures listing
  IDs, marketplace URLs, and item titles as you browse Nifty. POSTs
  to our `/api/admin/items` endpoint. Estimated: 1–2 sessions.
- **CSV sale detection.** Nightly Nifty export diffed against our
  items table to flag sold items. Auto-shows SOLD badges in journal
  posts. Estimated: half a session.
- **Migrate journal posts from markdown to database.** Replaces the
  current "write a markdown file, push" flow with an in-dashboard
  editor. The Claude draft generator can write directly into the new
  posts table instead of asking you to copy/paste. Estimated: 1
  session.
- **Pause/end controls for eBay sales** once the Marketing API works
  again. Code is mostly there; just hasn't been tested.

The smart sequence is whichever generates the most value-per-build
for the next month. The newsletter is probably highest leverage — it
captures revenue from existing buyers without any inventory work.
