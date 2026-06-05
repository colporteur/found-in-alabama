# Phase 2B.1 setup — auto-publish

Adds a "Publish to site" button next to the existing "Copy markdown" so
you can publish a haul post end-to-end from your phone (or anywhere)
without copy-paste or git on the command line.

Also splits the single "Notes" input into two fields:
- **Where it came from** — the acquisition story (estate, auction, source, dates)
- **What's in the photo** — items visible in the hero image

Both flow into Claude's prompt to produce a more concrete narrative.

## 1. Create a GitHub personal-access token

1. Go to https://github.com/settings/personal-access-tokens/new (fine-
   grained PAT) or https://github.com/settings/tokens/new (classic).
2. **Token name:** `Found in Alabama publish`
3. **Expiration:** 1 year (set a calendar reminder to rotate)
4. **Repository access:**
   - Fine-grained: Only select repositories → `colporteur/found-in-alabama`
   - Classic: Full control of private repositories
5. **Permissions** (fine-grained only):
   - Contents: **Read and write**
   - Metadata: Read (auto-selected)
6. Click **Generate token**
7. **Copy the token** — starts with `github_pat_...` or `ghp_...`. It's
   only shown once.

## 2. Add the env var in Vercel

1. Open `vercel.com/colporteurs-projects/found-in-alabama` → Settings → Environment Variables
2. Add:
   - **Key:** `GITHUB_TOKEN`
   - **Value:** the token from step 1
   - **Environments:** Production (all three is fine)
3. Save

Optional, if your repo isn't at `colporteur/found-in-alabama`:
- `GITHUB_OWNER` — defaults to `colporteur`
- `GITHUB_REPO` — defaults to `found-in-alabama`
- `GITHUB_BRANCH` — defaults to `main`

## 3. Pull and paste locally

```powershell
cd C:\Users\noren\found-in-alabama
vercel env pull --environment=production .env.local
```

Same Sensitive-flag dance: `GITHUB_TOKEN` may come down empty. If so:

```powershell
notepad .env.local
```

Find `GITHUB_TOKEN=""` and paste the real value:
```
GITHUB_TOKEN="github_pat_...your-real-token..."
```

Save.

## 4. Apply the code changes

```powershell
robocopy "C:\Users\noren\AppData\Roaming\Claude\local-agent-mode-sessions\86389833-3e36-4674-9a52-65e418775700\1f05f1b8-1012-4f98-9d65-01e021d677a3\local_395f541e-88d6-4280-8df8-88ae82777303\outputs\found-in-alabama" "C:\Users\noren\found-in-alabama" /E /XD node_modules .next .git

# Ctrl+C dev server
npm run dev
```

## 5. Test it

1. Open `http://localhost:3000/admin/draft` (or production URL on phone)
2. Pick a hero photo
3. Fill in **Where it came from** (estate/auction/etc.)
4. Fill in **What's in the photo** (items visible)
5. Click **Generate draft with Claude**
6. Edit any of the four fields if needed
7. Click **Publish to site →**
8. Wait ~5 seconds — you should see a green "Published" banner with a
   link to the post
9. Vercel rebuilds in ~60 seconds — refresh the post URL until it loads

## 6. Push to deploy

```powershell
git add .
git commit -m "Phase 2B.1 — auto-publish + split context fields"
git push
```

## What if "Publish to site" fails

The manual fallback is still there. Expand "Manual publish fallback" on
the draft page after a generation, and follow the four-step copy-paste-
push instructions. Works the same as before this phase.

Common failure modes:

- **`GITHUB_TOKEN is not set`** — step 3 didn't save. Restart dev after
  editing `.env.local`.
- **`...already exist...`** — slug collision. Edit the Slug field before
  clicking Publish.
- **`401 Bad credentials`** — token revoked or expired. Regenerate in
  step 1, repeat steps 2-3.
- **`403 Forbidden`** — token doesn't have Contents:write permission.
  Re-generate with the right scope.

## How it works

The Publish button POSTs to `/api/admin/publish`, which:

1. Validates the request (slug, title, body, image, etc.)
2. Sanitizes the slug into kebab-case
3. Checks GitHub for filename collisions on both the .md and the photo
4. Builds the frontmatter + body into a complete .md file
5. Uses the **Git Data API** to commit both files as a single atomic
   commit on `main` (cheaper than two separate commits — only one
   Vercel rebuild)
6. Returns the new post's URL

The hero image gets stored at `public/photos/posts/{slug}-hero.{ext}`
in the repo (same place as your existing manual workflow). The
markdown file lives at `content/posts/{slug}.md`.

After the commit, Vercel auto-detects the push and rebuilds. Total time
from "Publish" click to post being live: about 60–90 seconds.

## Things deferred to a later phase

- Editing existing posts in the dashboard
- Scheduling posts (write now, publish later)
- Attaching captured eBay items to a haul post automatically
- Image optimization on upload (right now we commit the raw photo;
  Vercel serves it through its CDN but doesn't re-encode)

All of those land in Phase 2E (full DB migration) if/when you want them.
