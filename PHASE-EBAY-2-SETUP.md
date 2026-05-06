# Phase eBay-2 setup checklist

What's new: a Sales & Promotions section under `/admin/ebay/sales` that
schedules markdown sales, order discounts, and codeless vouchers via
eBay's Sell Marketing API. This API requires OAuth — separate from the
Auth'n'Auth user token we use elsewhere — so there's a one-time setup.

Work through this in order.

## 1. Create a Redirect URL in the eBay developer portal

eBay's OAuth flow uses a "RuName" — an identifier eBay assigns to the
redirect URL you register. You'll need both: the URL goes in
`EBAY_OAUTH_REDIRECT_URI`, and the RuName goes in `EBAY_RU_NAME`.

1. Go to https://developer.ebay.com → **My Account** → **Application
   Keysets** → click into your production keyset.
2. Find **User Tokens** (same place you got the Auth'n'Auth token earlier).
3. Click **Add eBay Redirect URL** (sometimes labeled "Add OAuth
   Redirect URI").
4. Fill in:
   - **Your auth accepted URL:** `https://www.foundinalabama.com/api/admin/ebay/oauth/callback`
   - **Your auth declined URL:** `https://www.foundinalabama.com/api/admin/ebay/oauth/callback?declined=1`
   - **Privacy policy URL:** `https://www.foundinalabama.com/privacy` (or any URL — eBay just stores it)
5. Save. eBay shows a **RuName** that looks like `tknh-Inventor-1234-abcdef`. Copy it.

## 2. Generate a state secret

In PowerShell (or anywhere):

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
```

…or use https://generate-secret.vercel.app/32. Copy the result.

## 3. Add the env vars in Vercel

Open the project in Vercel → **Settings** → **Environment Variables**.
Add three vars (Production environment is fine):

| Name | Value |
|------|-------|
| `EBAY_RU_NAME` | The RuName from step 1.5 |
| `EBAY_OAUTH_REDIRECT_URI` | `https://www.foundinalabama.com/api/admin/ebay/oauth/callback` |
| `EBAY_OAUTH_STATE_SECRET` | The string from step 2 |

Save and **redeploy** (env var changes only apply to new deployments).

## 4. Robocopy + push the Phase 2A code

```powershell
cd C:\Users\noren\found-in-alabama
robocopy "C:\Users\noren\AppData\Roaming\Claude\local-agent-mode-sessions\86389833-3e36-4674-9a52-65e418775700\1f05f1b8-1012-4f98-9d65-01e021d677a3\local_395f541e-88d6-4280-8df8-88ae82777303\outputs\found-in-alabama" "C:\Users\noren\found-in-alabama" /E /XD node_modules .next .git
npm run db:generate
npm run db:migrate
git add .
git commit -m "Phase eBay-2A — OAuth + Sell API client"
git push
```

`db:migrate` adds the `ebay_oauth_tokens` table to your Postgres.

## 5. Connect

1. After the rebuild, visit `https://www.foundinalabama.com/admin/ebay/sales/connect`.
2. Confirm the three env-var rows show **Set**.
3. Click **Connect eBay account**. You'll be redirected to eBay, asked
   to sign in (use the alabamacollects account), and shown a consent
   screen listing the scopes we ask for.
4. Approve. You'll be redirected back to the connect page with a
   "✅ Connected" banner.
5. Click **Test connection**. Within a few seconds you should see
   "✅ Sell API call succeeded" with the count of any active or
   scheduled promotions on your account (likely 0 to start).

## 6. If anything breaks

- **"redirect_uri_mismatch"** — your `EBAY_OAUTH_REDIRECT_URI` doesn't
  match what you typed into the dev portal. They must be byte-identical
  (no trailing slash, exact protocol, exact case).
- **"invalid_scope"** — eBay sometimes objects to a scope that hasn't
  been enabled on your keyset. Open `lib/ebay/oauth.ts`, comment out the
  problematic scope from `REQUIRED_SCOPES`, push again, and reconnect.
- **"bad_state" on the callback** — `EBAY_OAUTH_STATE_SECRET` differs
  between the two requests (e.g. you redeployed mid-flow). Click
  Connect again — that issues a fresh state.
- **Test connection returns 403 "Insufficient permissions"** — your
  keyset may not have Sell APIs enabled. Confirm in the dev portal
  under your keyset's API access.
- **HTML error page on the callback** — production deploy hadn't picked
  up the new env vars yet. Trigger a redeploy and try again.

## What this gives you

- One-time consent grant from your seller account
- Encrypted refresh token stored in Postgres (refreshes silently)
- A working Sell API client ready for Phase 2B (sales schema) and 2C
  (the create-sale UI)
