# Phase 2B setup checklist

What's new: a Claude API integration that drafts haul narratives from a
hero photo + brief notes. Lives at `/admin/draft`.

## 1. Get an Anthropic API key

1. Go to https://console.anthropic.com
2. Sign in with `colporteurbooks@gmail.com` (or sign up if new)
3. Go to **Plans & Billing** → add $5-10 of credit. (Drafts cost about
   $0.02 each at Sonnet pricing — $5 covers ~250 generations.)
4. Go to **API Keys** → **Create Key** → name it `Found in Alabama production`
5. Copy the key (starts with `sk-ant-...`). **It's only shown once.**

## 2. Add the env var in Vercel

1. Open your project: `vercel.com/colporteurs-projects/found-in-alabama`
2. Settings → Environments → click **Production** → scroll to the env var
   list → **Add Environment Variable**
3. Key: `ANTHROPIC_API_KEY`
4. Value: paste the `sk-ant-...` key
5. Environments: just Production is fine (same as the AUTH vars)
6. Save

## 3. Pull the env var locally and add to .env.local

```powershell
cd C:\Users\noren\found-in-alabama
vercel env pull --environment=production .env.local
```

This pulls the new variable. But because Vercel marks it Sensitive by
default, the value will probably come down empty. Check:

```powershell
type .env.local | Select-String "ANTHROPIC"
```

If `ANTHROPIC_API_KEY=""` (empty), open `.env.local` in Notepad and paste
the key in manually:

```
ANTHROPIC_API_KEY="sk-ant-...your-key-here..."
```

Save the file.

## 4. Robocopy Phase 2B files into your working folder

```powershell
robocopy "C:\Users\noren\AppData\Roaming\Claude\local-agent-mode-sessions\86389833-3e36-4674-9a52-65e418775700\1f05f1b8-1012-4f98-9d65-01e021d677a3\local_395f541e-88d6-4280-8df8-88ae82777303\outputs\found-in-alabama" "C:\Users\noren\found-in-alabama" /E /XD node_modules .next .git
```

## 5. Install the Anthropic SDK and restart dev

```powershell
cd C:\Users\noren\found-in-alabama
npm install
npm run dev
```

Note: `db:migrate` and `drizzle.config.ts` were also updated to read
`.env.local` directly, so you can delete the duplicate `.env` file you
created earlier:

```powershell
Remove-Item .env
```

## 6. Test the draft generator end-to-end

1. Go to `http://localhost:3000/admin/draft`
2. Upload a hero photo (any haul photo will do — try one of the existing
   ones in `public/photos/`)
3. Enter notes describing the haul (at least a sentence)
4. Click **Generate draft with Claude**
5. Wait 5-15 seconds. A draft should appear with editable title, slug,
   excerpt, and body fields.
6. Edit anything that doesn't sound right.
7. Click **Copy as markdown**.
8. Open Notepad, paste — you should see a complete `.md` file with
   frontmatter and body. This is what you'd save as a new post.

## 7. Push to deploy

Once the local test passes:

```powershell
git add .
git commit -m "Phase 2B — Claude API draft generation"
git push
```

Vercel auto-rebuilds in about a minute. Then `/admin/draft` works in
production too.

## What this gives you

A working draft generator. You can use it today to draft real haul posts.
The "save" step is still manual (copy markdown, create file, drop photo,
git push), but the hardest part — writing the narrative — is now a
2-second click.

## What's still ahead

- **Phase 2C** — Chrome extension to auto-capture items from Nifty.ai.
  Needs your two Nifty tests first (recreate-and-export, DOM inspection).
- **Phase 2D** — Sale detection from nightly CSV exports.
- **Phase 2E** — Migrate journal posts from markdown to database, with a
  proper editor UI that includes the draft generator inline.

## If anything breaks

- *"ANTHROPIC_API_KEY is not set"* — step 3 didn't complete. Check
  `.env.local` actually has the key value, restart dev server.
- *"Unauthorized" on /api/admin/draft* — your sign-in cookie expired.
  Visit `/signin` and sign in again.
- *Claude returns garbled JSON or non-JSON output* — rare, but if it
  happens twice in a row tell me and I'll tighten the prompt.
- *Generation takes >30 seconds* — image is probably too large. Resize
  to under 2000px on the long edge before uploading. Squoosh.app is good
  for this.
