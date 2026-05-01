# Phase 2A setup checklist

This is the platform-side setup you do in browser UIs. The code I wrote
in this batch assumes everything below is in place. Work through it in
order — most steps take a few minutes each.

## 1. Sign up for Resend (sends the sign-in emails)

1. Go to https://resend.com and sign up with `colporteurbooks@gmail.com`.
   The free plan covers 100 emails/day, 3000/month — way more than
   you'll need.
2. After signup, go to **Domains** → **Add Domain** → enter
   `foundinalabama.com`.
3. Resend shows a list of DNS records to add at Cloudflare (typically
   3-4 records: TXT for SPF, CNAME for DKIM, MX optional). Add them at
   Cloudflare (DNS only, gray cloud — same rule as before).
4. Click **Verify** in Resend. It usually takes 5-30 minutes for DNS to
   propagate. The status flips to "Verified" when ready.
5. Once verified, go to **API Keys** → **Create API Key**. Name it
   `Found in Alabama production`. Copy the key — you'll need it in
   step 3. **It's only shown once.**

## 2. Provision Vercel Postgres

1. Open your Vercel project: `vercel.com/colporteurs-projects/found-in-alabama`.
2. Go to **Storage** in the left nav (might be under a "..." menu in
   newer Vercel UIs).
3. Click **Create Database** → **Postgres**.
4. Region: pick `iad1` (US East) — closest to your users.
5. Click **Create & Continue**, then **Connect Project** with the
   `found-in-alabama` project selected, all environments checked.
6. Vercel automatically adds the connection env vars (`POSTGRES_URL`,
   `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, etc.) to your
   project — you don't need to set those manually.

The free tier is 256MB storage and 60 compute hours/month. More than
enough for 5,000+ items.

## 3. Add the rest of the environment variables in Vercel

Open your project → **Settings** → **Environment Variables**.

Add the following, all environments checked (Production, Preview,
Development):

| Name | Value |
|------|-------|
| `AUTH_SECRET` | Generate with `openssl rand -base64 32` in PowerShell, or use https://generate-secret.vercel.app/32 |
| `AUTH_URL` | `https://www.foundinalabama.com` |
| `AUTH_RESEND_KEY` | The Resend API key from step 1.5 |
| `AUTH_EMAIL_FROM` | `Found in Alabama <hello@foundinalabama.com>` (any `@foundinalabama.com` address — Resend will accept it once domain is verified) |
| `ADMIN_EMAIL` | `colporteurbooks@gmail.com` (the only email allowed to sign in) |

After adding all five, **redeploy** the project (Deployments tab →
"..." menu on the latest deploy → Redeploy). Env var changes don't
apply to running deployments, only new ones.

## 4. Pull env vars to your local machine

In your project folder in PowerShell:

```powershell
# Install the Vercel CLI globally if you don't have it
npm install -g vercel

# Link this folder to the Vercel project (one-time, follow the prompts)
vercel link

# Pull the env vars from Vercel into a local .env file
vercel env pull .env.local
```

You should now have a `.env.local` file with all the env vars. **It's
gitignored automatically** — don't commit it.

## 5. Install new dependencies and run the first migration

```powershell
npm install
npm run db:generate
npm run db:migrate
```

`db:generate` creates the SQL migration files based on the schema I
wrote. `db:migrate` runs them against your Vercel Postgres database,
creating the `items`, `user`, `account`, `session`, and
`verificationToken` tables.

## 6. Test sign-in locally

```powershell
npm run dev
```

1. Open http://localhost:3000/admin in your browser.
2. You should be redirected to `/signin`.
3. Enter `colporteurbooks@gmail.com`. Submit.
4. Check your inbox — you should get a "Sign in to Found in Alabama"
   email from Resend within seconds.
5. Click the link. You should land back on `/admin` and see your
   dashboard placeholder ("Welcome, colporteurbooks@gmail.com").
6. Try entering a different email at `/signin`. The submit will
   succeed (it always does for security reasons — to prevent email
   enumeration), but no email will arrive. Only your `ADMIN_EMAIL`
   address can actually sign in.

## 7. Push and deploy

```powershell
git add .
git commit -m "Phase 2A — auth, database, admin shell"
git push
```

Vercel will rebuild. Once that's done, repeat step 6 against
`https://www.foundinalabama.com/admin` to confirm sign-in works in
production.

## What this gives you

- A protected `/admin` area only you can access
- A Postgres database ready to receive items from the Chrome extension
  (built in Phase 2C)
- The auth foundation that future Phase 2 features (post editor,
  Claude drafts, etc.) will build on

## What this does NOT yet do

- Capture items from Nifty (Phase 2C)
- Generate haul narratives via Claude (Phase 2B)
- Detect sales from your CSV (Phase 2D)
- Edit posts via dashboard (Phase 2E — posts still live in markdown
  files for now)

## If anything breaks

- Vercel build fails with "DATABASE_URL not defined" → Step 2 wasn't
  completed, or the Postgres database isn't connected to this project.
- Sign-in email never arrives → Step 1 (Resend domain verification)
  isn't fully done. Check Resend dashboard for the domain status.
- Sign-in email arrives but link gives an error → `AUTH_URL` is wrong.
  Should be `https://www.foundinalabama.com` (with www, since that's
  the canonical URL).
- "Configuration" error on the sign-in page → `AUTH_SECRET` is missing
  or empty. Re-check step 3.
- Migrations fail with "relation already exists" → the migration was
  already run; that's fine, ignore it.
