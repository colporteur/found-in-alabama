# Deploying Found in Alabama

A step-by-step from "files on my computer" to "live at foundinalabama.com".
You'll do this once. Future updates are just `git push` and Vercel auto-rebuilds.

## What you'll need

- Node.js 20+ installed locally — download from https://nodejs.org if you don't have it
- The folder this README sits in (the whole `found-in-alabama` directory)
- Your GitHub account (github.com/colporteur)
- Your Vercel account
- Access to your foundinalabama.com domain registrar

## 1. Verify the site runs locally

Open a terminal in this folder and run:

```bash
npm install
npm run dev
```

Open http://localhost:3000 in a browser. You should see the home page.
Click around — every link should work. Stop the server with Ctrl+C when done.

If `npm install` errors out, double-check your Node version with `node --version`
— it needs to be 20 or higher.

## 2. Add your photos

Drop the five photos you sent me into the `public/photos/` folder using the
exact filenames listed in `public/photos/README.md`. Skip this step for now if
you'd rather see the text-only version go live first; you can add them later.

## 3. Edit the About page copy

Open `app/about/page.tsx` in any text editor. The placeholder copy is
clearly marked at the top of the file with a comment. Rewrite anything that
doesn't sound like you. Save the file.

You can preview your changes live by running `npm run dev` again — saves
hot-reload in the browser.

## 4. Push to GitHub

Create a new repository on GitHub:

1. Go to https://github.com/new
2. Repository name: `found-in-alabama` (or whatever you want)
3. Set it to **Private** unless you want the code public
4. Don't initialize with a README — we already have one
5. Click "Create repository"

Then in your terminal, in this folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/colporteur/found-in-alabama.git
git push -u origin main
```

(Replace the URL with whatever GitHub gave you on the new-repo page.)

## 5. Deploy to Vercel

1. Go to https://vercel.com/new
2. Click "Import Git Repository"
3. Authorize GitHub if prompted, then select the `found-in-alabama` repo
4. Vercel will auto-detect Next.js — leave all settings at their defaults
5. Click "Deploy"

About 60 seconds later, you'll have a live URL like
`found-in-alabama-xyz.vercel.app`. Open it. Your site is live on the internet.

## 6. Point foundinalabama.com at Vercel

In your Vercel dashboard, open the project, go to Settings → Domains, and
add `foundinalabama.com` and `www.foundinalabama.com`.

Vercel will show you DNS records to add. Two paths from here:

**Easiest — transfer DNS to Vercel.** If your domain is at Cloudflare or
similar, you can leave it there but follow Vercel's instructions to add A
records (apex domain) and a CNAME (www) pointing to Vercel.

**Even easier — Cloudflare-specific.** If you registered through Cloudflare,
add these DNS records in Cloudflare:

- Type `A`, name `@`, value `76.76.21.21` (Vercel's apex IP)
- Type `CNAME`, name `www`, value `cname.vercel-dns.com`

Set proxy status to "DNS only" (gray cloud) for both, not proxied.

DNS propagation usually takes 5–30 minutes. Vercel will issue an SSL
certificate automatically.

## 7. Future updates

Any change to the site is now a three-step loop:

```bash
# Edit files, then:
git add .
git commit -m "Brief description of what changed"
git push
```

Vercel auto-detects the push and redeploys in about a minute.

## Troubleshooting

- **`npm install` fails with permissions errors:** try `sudo npm install` on
  Mac/Linux, or run terminal as Administrator on Windows.
- **Build fails on Vercel but works locally:** check the Vercel build logs.
  99% of the time it's a missing dependency — make sure `package.json` is
  committed.
- **Domain shows Vercel's "Configuration error" page:** DNS hasn't propagated
  yet. Wait 30 minutes and reload.
- **You see "Module not found: Can't resolve '@/...'":** this is the path
  alias from `tsconfig.json`. If your editor flags it but the build works,
  ignore — it's an editor-only issue.

## After pulling new changes (e.g. when I add features)

If I've added new features and you pull the changes, **always re-run
`npm install`** before `npm run dev` — there may be new dependencies in
`package.json` that need installing. Skipping this step causes
`Module not found` errors at runtime.

```bash
git pull
npm install
npm run dev
```

## What's in Phase 1 (current)

- Static About / We Buy / Contact / Find Me pages
- Brand identity matching the business card
- Footer with all marketplace and social links
- **Journal** (file-based) — write posts as markdown files in
  `content/posts/`, see that folder's README for details

## What's not yet built (Phase 2)

- Chrome extension to capture inventory from Nifty.ai
- Database for items
- Claude API integration for generating haul narratives
- Sale detection from CSV exports
- Auto-population of haul-post item lists from Nifty data

These can be added after the static site is live and you've published
a few posts by hand.
