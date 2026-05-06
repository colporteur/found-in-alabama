# Phase eBay-1 setup checklist

What's new: an `/admin/ebay` section that re-categorizes the listings sitting
in your Store's "Other" bucket. Phase 1 just covers Step 1 (re-categorization).
Sales scheduling (Phase 2) and customer newsletters (Phase 3) come later.

Work through this in order — most steps take a few minutes each.

## 1. Get the four eBay app keys from your developer account

1. Go to https://developer.ebay.com → sign in.
2. Top-right → **My Account**.
3. Under **Application Keysets**, find the production keyset (or create one if
   you've only ever used sandbox).
4. Copy the four values:
   - **App ID (Client ID)** → goes in `EBAY_APP_ID`
   - **Dev ID** → goes in `EBAY_DEV_ID`
   - **Cert ID (Client Secret)** → goes in `EBAY_CERT_ID`

## 2. Generate a long-lived Auth'n'Auth user token

This is the token that authorizes the app to act on your eBay account.
"Auth'n'Auth" is eBay's older token style — single value, ~18 month lifetime,
trivial to rotate. Modern OAuth would also work but is overkill for a
single-user admin tool.

1. In the developer portal, go to **My Account** → **User Tokens**
   (might be under "Get a User Token" depending on the UI version).
2. Choose your **production** keyset.
3. Click **Sign in to Production** (or "Get a User Token"). You'll be sent
   to a normal eBay sign-in page — sign in with your seller account
   (the one whose listings you want to manage).
4. After signing in, the portal shows a token string starting with
   `AgAAAA...` — long, ~700 characters. Copy the whole thing.
5. Store the token's **expiration date** somewhere — it's typically 18 months
   out. Set a calendar reminder for 30 days before that to regenerate. (When
   it expires, listings will fail with a 21916984 error code; the fix is just
   to repeat this step and paste the new token.)

## 3. Add the env vars to `.env.local`

Open `C:\Users\noren\found-in-alabama\.env.local` (your real working copy,
not the staging folder). Add at the bottom:

```
EBAY_APP_ID="...your App ID..."
EBAY_DEV_ID="...your Dev ID..."
EBAY_CERT_ID="...your Cert ID..."
EBAY_AUTH_TOKEN="...the long AgAAAA... token from step 2..."
EBAY_ENV="production"
EBAY_SITE_ID="0"
```

(If you also want to mirror these to Vercel for the production deploy, do it
in **Settings → Environment Variables** the same way you set
`ANTHROPIC_API_KEY`. But the Phase eBay-1 plan is **local dev only first** —
don't push to production until we've verified end-to-end.)

## 4. Robocopy Phase eBay-1 files into your working folder

```powershell
robocopy "C:\Users\noren\AppData\Roaming\Claude\local-agent-mode-sessions\86389833-3e36-4674-9a52-65e418775700\1f05f1b8-1012-4f98-9d65-01e021d677a3\local_395f541e-88d6-4280-8df8-88ae82777303\outputs\found-in-alabama" "C:\Users\noren\found-in-alabama" /E /XD node_modules .next .git
```

## 5. Install the new dependency and run the database migration

```powershell
cd C:\Users\noren\found-in-alabama
npm install            # picks up fast-xml-parser
npm run db:generate    # generates SQL for the 4 new ebay_* tables
npm run db:migrate     # runs it against Vercel Postgres
```

If `db:migrate` complains about a missing connection, make sure
`vercel env pull --environment=production .env.local` has been run recently
(per Phase 2A step 4) so the `POSTGRES_*` vars are present.

## 6. Test the eBay connection

```powershell
npm run dev
```

1. Open http://localhost:3000/admin → sign in if prompted.
2. Click **eBay tools** in the admin nav. The dashboard should load with
   "Connected" badge if your env vars are in place.
3. Click into **Connection settings** (or visit `/admin/ebay/connect`).
4. Click **Test connection**. Within ~5 seconds you should see:
   - Your eBay store name
   - The number of top-level Store custom categories
   - A "✅ Trading API call succeeded" line

If it fails:

- *"EBAY_AUTH_TOKEN is not set"* → step 3 didn't save the env var. Restart
  `npm run dev` after editing `.env.local`.
- *"Failure: Invalid token"* → token was copied with a leading/trailing
  newline or was for the sandbox keyset. Regenerate from production.
- *"Failure: Application is not authorized..."* → the keyset's compatibility
  with the Trading API isn't enabled. In the developer portal, open the
  keyset → **Manage Application** → confirm Trading API is enabled.
- HTML response instead of XML → almost always means the request hit
  Cloudflare in front of eBay (rare, transient). Wait a minute and retry.

## 7. What to do once it's connected

- Step 1 of the dashboard ("Sync store categories") becomes available — run
  it. This reads your full Store category tree, auto-flags Alabama-related
  ones, and lets you tweak the flags.
- Step 2 ("Pull listings") finds every listing whose Store Category 1 is
  "Other" and Store Category 2 is empty.
- Step 3 ("Review &amp; approve") opens the Claude-driven re-categorization
  flow.
- Step 4 ("History") audits everything that was pushed back to eBay.

I'll wire those up after you confirm the connection test works in step 6.
