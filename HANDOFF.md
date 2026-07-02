# Found in Alabama — Project Handoff

*Last updated: mid-conversation on 2026-07-01. This document briefs a fresh Claude Cowork thread on everything it needs to pick up work on this project without churn.*

---

## 1. Who this is for and what it is

**Todd** runs Found in Alabama, a small Alabama-based reseller business (estate finds, vintage books, ephemera, and small antiques) sold across six marketplaces (eBay, Etsy, Poshmark, Mercari, Depop, Whatnot). This project — the `found-in-alabama` codebase — is his internal admin tool + public storefront/journal, deployed at [foundinalabama.com](https://www.foundinalabama.com).

Todd is technical (comfortable with git, PowerShell, deploying to Vercel) but not a full-time dev — he prefers substantive, honest advice, incremental phase-by-phase builds, and full cost transparency for API-heavy features. He handles all deploys himself via PowerShell after we produce the diff.

## 2. Directory locations (Windows host paths)

**Main project** — the Next.js app deployed to Vercel:
```
C:\Users\noren\found-in-alabama
```

**Expert guides** — markdown niche-collecting guides (Aviation Photography, Postcards, Costume Jewelry, Vintage Photo, 1980s-90s Photo Values):
```
C:\Users\noren\expertguides
```

**Nifty Chrome extension** — separate project, has its own "Expert Mode" that already consumes the guides above:
```
C:\Users\noren\OneDrive\Documents\Claude\Projects\Agent API and Nifty Pricer Extension\nifty-bin-price-recommender
```

**Agent Price Researcher API** — separate Python service Todd built for market-price research on individual items. Local, exposed via Cloudflare Tunnel at `https://aprapi.dev`. Uses Gemini 2.5 Flash + SerpAPI or ScrapingBee (Todd is unsure which he’s actually running — worth verifying):
```
C:\Users\noren\AgentPriceResearcher
```

## 3. Tech stack

- **Framework:** Next.js 14 App Router, TypeScript, deployed on Vercel
- **Database:** Vercel Postgres (Neon Launch tier — $19/mo, 100 GB egress), Drizzle ORM
- **Auth:** NextAuth v5 with Resend magic-link email
- **AI:** Anthropic Claude — **Sonnet 5** for creative work (`claude-sonnet-5`), **Haiku 4.5** for classification (`claude-haiku-4-5-20251001`)
- **Email:** Resend (via direct HTTP fetch, not SDK)
- **Publish pipeline:** Journal posts commit to GitHub via Contents API, Vercel auto-rebuilds
- **Social auto-posting:** direct API for BlueSky, Pinterest (currently blocked, see §6); Publer for Instagram/Facebook/X
- **eBay:** Trading API for listing mutations (ReviseItem is the workhorse), Sell API OAuth for Marketing/promotions
- **Analytics:** Vercel Web Analytics
- **Cron:** single Vercel cron at `/api/cron/publish` runs daily at 13:00 UTC (auto-schedules social drafts + publishes due ones, `PUBLISH_BATCH=1`)

## 4. Key file/folder layout in the main project

```
found-in-alabama/
  app/
    admin/                    Admin UI (auth-gated)
      draft/                  Haul draft generator (Claude + factual grounding)
      drafts/                 NEW: saved-draft index page
      journal/                Manage published haul posts (edit form)
      ebay/                   eBay categorizer + sales tools
      social/                 Social copy generator + queue
      newsletter/             Newsletter subscribers + drafts editor
      inventory/              Inventory browser
      api-keys/               Chrome extension API keys
      settings/posting/       Posting-adapter connection status
    api/
      admin/                  Admin API routes (draft, haul-drafts, publish, ebay, social, newsletter)
      cron/                   /publish, /sync-listings, /ebay-sales
      newsletter/             Public subscribe/confirm/unsubscribe
    journal/                  Public journal (hauls only — filtered from live-sale + travel)
    products/                 Public per-product pages
    shop/                     Public storefront by store category
  components/                 React components (PostCard, NewsletterSignup, PinterestConnectionCard, etc.)
  content/
    posts/                    Published haul-post markdown + frontmatter
  db/
    schema.ts                 Drizzle schema — all tables live here
    index.ts                  Exports `db` + all schema tables
    migrate.ts                Migration runner (npm run db:migrate)
  drizzle/                    Generated migration SQL files (0000… through 0016…)
  lib/
    claude.ts                 Claude SDK client + DRAFT_MODEL + DRAFT_SYSTEM_PROMPT
    ebay/                     Trading API client, listing sync, auto-categorize, sales
    posting/                  Posting adapters per channel (bluesky, pinterest, publer)
    pinterest/                Pinterest OAuth + API v5 wrapper
    publer/                   Publer API wrapper
    social/                   Social copy generation (prompts, channel-styles, auto-generate)
    newsletter/               Newsletter data collection, prompts, render, send
    posts.ts                  Filesystem markdown post loader
    posts-edit.ts             Raw markdown + frontmatter reader for the edit page
    api-keys.ts               API key hash pattern (SHA-256)
    github.ts                 GitHub Contents API wrapper for auto-publish
  public/
    photos/posts/             Hero + gallery images for haul posts (uploaded via publish flow)
  vercel.json                 Cron config (only one cron: publish at 0 13 * * *)
```

## 5. Environment variables (Vercel prod + `.env.local`)

- Auth: `AUTH_URL`, `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `ADMIN_EMAIL`
- Anthropic: `ANTHROPIC_API_KEY`
- Database: `POSTGRES_URL` (Neon)
- eBay Trading: `EBAY_APP_ID`, `EBAY_DEV_ID`, `EBAY_CERT_ID`, `EBAY_AUTH_TOKEN`, `EBAY_ENV` (`production`), `EBAY_SITE_ID`, `EBAY_STORE_USERNAME`, `EBAY_PROMOTION_IMAGE_URL`
- eBay OAuth (Sell APIs): `EBAY_OAUTH_STATE_SECRET`
- GitHub publish: `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_TOKEN`
- Pinterest: `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET`, `PINTEREST_REDIRECT_URI`, `PINTEREST_OAUTH_STATE_SECRET`
- Publer: `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID`
- BlueSky: `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`
- Newsletter: `RESEND_API_KEY` (fallback to `AUTH_RESEND_KEY`), `NEWSLETTER_BUSINESS_ADDRESS`
- Cron: `CRON_SECRET` (Vercel cron auth)
- Debug: `EBAY_DEBUG` (optional, dumps raw XML to console)

## 6. Current state — what just shipped

Recent work (in rough chronological order):

- **Newsletter Phases 4A-4D** — email signup (double opt-in via Resend), Claude-generated drafts in two flavors (email + eBay Seller Hub), send via Resend with idempotent per-recipient log, retry-failed view, CSV export, images embedded in email flavor with absolutized URLs, hardcoded "Text 256-684-1253" CTA (email only, never eBay).
- **Haul draft: equal-weighted photos + factual grounding** — either haul photos OR context photos are sufficient; both carry equal narrative weight; system prompt rewritten to forbid inventing brands/dates/names beyond what’s in the inputs.
- **Save haul drafts** — new `haul_drafts` table (photos in JSONB), `/api/admin/haul-drafts` CRUD, `/admin/drafts` index page, `/admin/draft?id=N` loads a saved draft, publish auto-deletes the draft.
- **Sonnet 5 migration** — model string swap across `lib/claude.ts` and `lib/social/generate.ts`; max_tokens bumped (1500→2500 for haul, 3500→5000 for newsletter per flavor, 2500→3500 for social) to absorb Sonnet 5’s ~30% tokenizer increase + adaptive-thinking overhead. Intro pricing $2/$10 through 2026-08-31 (~13% cheaper), then standard $3/$15 (~30% more expensive than 4.6 for same text).
- **Journal cleanup** — hauls-only on the public index; live-sale and travel filter buttons removed; header copy updated (was "Hauls, live shows, and where we’re headed"). Legacy posts of the retired types still render at direct URLs.
- **Pinterest OAuth fix** — `REQUIRED_SCOPES` was missing `boards:write`; added it (v5 requires both `pins:write` AND `boards:write` to create pins). Added `POST /api/admin/social/drafts/bulk-retry` + a "Retry batch of 10" button on the Failed tab of `/admin/social/queue`.

## 7. Currently blocked — do not spend effort here

**Pinterest posting is blocked** on Pinterest granting Todd’s developer app **Standard access**. His app is in Trial tier, which restricts pin creation to the sandbox API. He’s making the required demo video for the app-review process. Standard-access approval usually takes days to weeks. All code is ready — the scope fix is merged, the bulk-retry button works, cached boards + OAuth are intact. Once Pinterest approves, Todd just clicks "Retry batch of 10" repeatedly and burns through the ~87 failed drafts.

**Do not:**
- Reopen Pinterest debugging until Todd says approval came through
- Speculate about workarounds that involve using the sandbox API (those pins don’t appear on the real account, defeats the purpose)

## 8. Expert Enhance portal — Phase 0 SHIPPED (2026-07-01), Phase 1 up next

**Phase 0 is built and deployed.** What exists: schema tables `enhance_batches`, `enhance_jobs`, `ai_call_log`, `ai_model_pricing` (migration 0017); `lib/enhance/` (cost.ts = pricing lookup + lazy seeding + call logging, providers.ts = callLlm for Anthropic/OpenAI/Gemini + callHttpService for APR, ops.ts = empty handler registry, queue.ts = createBatch/cancelBatch/processTick with claim-based job locking); `/api/cron/enhance` runner tick (45s budget, CRON_SECRET or admin session); `.github/workflows/enhance-cron.yml` (every 5 min); dashboard shell at `/admin/ebay/enhance` (today/week/month spend by op+model, batch history, pricing table). OPENAI_API_KEY and GEMINI_API_KEY env vars are NOT yet set — needed from Phase 2 onward. APR question resolved: eBay Sold + Active tiers use **ScrapingBee** (stealth_proxy, ~75 credits/req); SerpAPI only feeds Google Lens (tier 5, never observed executing). Cost pass-through seeded at $0.03/research call, $0.01/quick lookup.

**Phase 1 SHIPPED (2026-07-01): price bump + SKU rename.** `lib/enhance/ops.ts` now registers `price_adjust` (percent/flat delta, floor clamp default 0.99, optional round-to-.87) and `sku_rename` (find/replace with exact/prefix/contains). Both fetch the item LIVE via `fetchItemCore()` (new in `lib/ebay/calls.ts`, alongside `reviseItemPrice`/`reviseItemSku`) so before-snapshots and math never trust the mirror; on success they sync the new value back to `ebay_listings`. Non-Active listings and auction-style (Chinese) listings are skipped, as are no-op changes. Batch creation: `POST /api/admin/enhance/batches` resolves selections (SKU exact/prefix/contains, store category, title, price range) against the `ebay_listings` mirror; `dryRun: true` gives the preview gate. Cancel via `POST /api/admin/enhance/batches/{id}/cancel`. UI: preview-first NewBatchForm on `/admin/ebay/enhance`, batch detail with per-job before→after at `/admin/ebay/enhance/[id]`. No schema changes in Phase 1.

**Phase 2 SHIPPED (2026-07-01): Item Specifics fill + UX fixes.** First LLM op. `item_specifics` handler in ops.ts: fills only EMPTY specifics (never overwrites) from title + stripped description + optional primary photo (fetched server-side, downsized via eBay's s-l500 URL variant); strict-JSON extraction prompt; default gemini:gemini-2.0-flash, `modelOverride` column carries "provider:model" (UI offers gpt-4o-mini). `fetchItemForSpecifics`/`reviseItemSpecifics` in calls.ts — NOTE: ReviseItem REPLACES the whole ItemSpecifics container, so the handler always writes the merged set. **Env needed before first run: `GEMINI_API_KEY` (and/or `OPENAI_API_KEY`) in Vercel + `.env.local`.** UX fixes shipped alongside: `decodeEntities` upgraded (numeric refs + multi-pass) and applied at sync ingestion, GetItem reads, batch route, and detail page (mirror rows from before this fix still carry entities until next full sync); dry-run preview now returns per-row projected `after` values ($13.97 → $13.87, NA60 → NA61).

**Post-Phase-2 polish (2026-07-01):** item_specifics dry-run preview now checks each sample item live (parallel GetItem, ≤10 rows) and shows per item "will fill: Color, Material · keeps: Brand, Size" so it's explicit which fields will be written vs. left alone before the batch runs.

**Phase 3 SHIPPED (2026-07-01): title + description remix with expert guides.** The five guides from `C:\Users\noren\expertguides` now live in `content/expert-guides/` with `manifest.json` (ids: aviation-photography, postcards, costume-jewelry, vintage-photos, photo-values-1980s-1990s); loader in `lib/enhance/guides.ts`. Handlers `title_remix` (Haiku 4.5 default) and `description_remix` (Sonnet 5 default) pass the guide as `cacheableSystem` so Anthropic bills it at 10% after the first job per batch. Guardrails: REMIX_HARD_RULES (no shipping/discount/return/price/invented-facts changes — mirrors Nifty Hard Rule 6), 80-char title enforcement with word-boundary truncation, NA### SKU strip from titles, description skipped if empty or >12k chars (truncate-then-replace would destroy content), rewrite rejected if <30% of original length. `fetchItemForRemix`/`reviseItemTitle`/`reviseItemDescription` in calls.ts. Config: `{ guideId, instructions? }`; model via modelOverride ("provider:model"). Description before/after snapshots capped at 20k chars in jsonb.

**Phase 4 SHIPPED (2026-07-01): price research reprice via APR.** Queue gained a "waiting" outcome: async jobs go back to pending with merged result state, re-claimed on a LATER tick (in-tick skip list prevents spin; 50-wait cap ≈ 4h timeout). `price_research` handler: submit tick POSTs `/api/v1/research` (X-API-Key, `idempotency_key: enhance-{jobId}` so crash resubmits don't double-bill, billable $0.03) and stashes `aprJobId` in job.result; later ticks poll unbillably; on complete applies anchor price (recommended p75 default / median) with floor + round-to-.87 + optional max-change-% guardrail (over-cap suggestions recorded in result as `suggestedPrice`, job skipped for manual review). In-flight cap 3 concurrent APR submissions per batch. Tunnel down / PC asleep → waiting-retry, not failure. **Env needed: `APR_API_URL` (default https://aprapi.dev) and `APR_API_KEY` (= APR's INTERNAL_API_KEY) in Vercel + `.env.local`.** Also fixed this session: gemini-2.0-flash was shut down by Google 2026-06-01 — defaults now gemini-2.5-flash (2.5 family sunsets 2026-10-16, noted in pricing table).

**Phase 5 SHIPPED (2026-07-01): rollback + history browser.** All three grains (decision #4). Engine in `lib/enhance/rollback.ts`: `rollbackEligibility` (blocks truncated ≥20k description snapshots; per-op snapshot checks) + `rollbackJob` (live Active check, op-appropriate ReviseItem restore, mirror sync, rolledBack flag + result.rolledBackAt; failures stored as result.rollbackError without clobbering job history) + `rollbackSlice` (time-budgeted batch/24h-window processing). item_specifics rollback REMOVES the specifics we added — but only those whose live value still equals what we wrote; hand-edited values survive. Routes: POST `/api/admin/enhance/jobs/[id]/rollback`, `/batches/[id]/rollback` (35s slices, client loops until remaining=0 — auto-categorize advance pattern), `/rollback-session` ({hours}, capped 7 days). UI: per-job Roll back buttons + rolled-back badges on batch detail, Roll back batch in header, history browser at `/admin/ebay/enhance/history` (latest 200 jobs cross-batch, op filter chips, session rollback button), linked from the dashboard. No schema change (rolledBack column existed since Phase 0).

**Workbench W1 SHIPPED (2026-07-01):** `/admin/ebay/workbench` — all active eBay inventory (mirror-based) with thumbnail/title/SKU/price, SQL SKU-schema classifier (`lib/enhance/sku-class.ts`: bin NA###, vinyl "RPM YYMMDD", media YYMMDD, named bins, card_legacy `367-m7qgb`, plain-number card, oversize = literal "Apps", none, irregular = cleanup worklist), natural SKU sorting, filters (text/class/category/price + wiggled/substantive "never"/30/60/90 days), 100/page. Schema (migration 0018 needed): `ebay_listings.last_wiggle_at` + `last_substantive_at`, stamped by queue.ts on COMPLETED jobs only (WIGGLE_OPS / SUBSTANTIVE_OPS consts in db/schema.ts); one-time idempotent backfill from job history at GET `/api/admin/enhance/backfill-last-actions`.

**Workbench W2 (next): checkbox action layer.** Per-row op checkboxes (2 wiggle + 4 substantive sections), select-all-on-page + select-all-matching-filter, Apply buttons opening per-op config panels that create batches with explicit itemIds (batches route already supports selection.itemIds), plus a "set exact SKU" mode on the sku_rename handler for hand-picked bin consolidation.

**Phase 6+ (future): automated cycler cron + shared guide library** — plus the earlier session's UX candidates: preview item-ID links shipped; possible next: retry-failed-jobs button, mirror-freshness indicator on the dashboard, calibration reporting once APR outcome capture (per APR_Architecture_Review.md) exists.

Original design (locked decisions still binding):

**Vision:** a portal at (likely) `/admin/ebay/enhance` for batch mutations on live eBay listings via `ReviseItem`. Small edits give a genuine algorithm freshness boost on eBay, but the substance is **expert-guide-informed listing improvements** — Claude reads the relevant expert guide for a niche and proposes value-added edits, not just cosmetic wiggles.

**Operations in the matrix:**
| Op | AI model | Notes |
|----|----------|-------|
| Price bump/discount | none (pure math) | Percent delta or flat, with floor |
| SKU rename | none | Find/replace, for bin consolidation |
| Item Specifics fill | **Gemini 1.5/2.0 Flash** or **GPT-4o-mini** | Structured extraction, cheap |
| Title remix (with guide) | **Haiku 4.5** (with prompt caching) or **Gemini Flash** | Short output |
| Description remix (with guide) | **Sonnet 5** (with prompt caching, default) / GPT-4o alternate / Gemini 1.5 Pro budget | Prose quality matters |
| Price research reprice | **Agent Price Researcher API** (`https://aprapi.dev`) | Not an LLM — HTTP service Todd built |

**Locked architectural decisions:**

1. **Queue-first from day one.** Batches run as background jobs, not synchronous Vercel calls. Reason: Agent Price Researcher is async (POST returns job_id, poll GET), and Todd will eventually want automated cycler runs. Retrofitting a queue after building sync flows is expensive.
2. **Multi-provider AI abstraction.** Common wrapper interface for Claude / OpenAI / Gemini calls. Second category for HTTP-service calls (the researcher). Both categories log to the same cost table.
3. **Cost tracker built in.** Every AI call and researcher call logs input/output/cached tokens (or request count for the researcher) + estimated cost in USD, computed at call time from a pricing lookup table. Dashboard widget shows today/week/month spend by op + model. Pre-batch cost estimator ("this batch will cost ~$X.XX, proceed?").
4. **Rollback with three grains:** per item, per batch, per session (last 24h). Backed by before/after snapshots in an `expert_enhance_log` table.
5. **Guide manifest scaffolding.** Guides copied into `content/expert-guides/` in this repo with a `manifest.json` describing name / applicable categories / version. Set up structure now so future shared guide library between this project and the Nifty extension is a plug-in later.
6. **Per-op model override in the UI.** Sensible defaults (as above) but Todd can switch per batch to A/B test cheaper vs. better on a small sample.
7. **Prompt caching wired in from day one.** Guide is the large cacheable prefix; per-item context is the small delta. At scale, this makes Sonnet 5 competitive with Gemini Flash on cost.

**Phase plan (each depends on Phase 0):**
- **Phase 0:** Job queue tables (`enhance_batches`, `enhance_jobs`, `ai_call_log`, `ai_model_pricing`), batch runner cron, AI provider abstraction, cost dashboard shell. Load-bearing scaffolding. No user-facing feature.
- **Phase 1:** Price bump + SKU rename. No AI. Exercises the queue.
- **Phase 2:** Item Specifics fill. First LLM op (Gemini Flash or GPT-4o-mini). Exercises AI wrapper.
- **Phase 3:** Title + description remix with expert guides. Core value feature. Guide loader + manifest, prompt caching, per-op model config.
- **Phase 4:** Price research reprice. Wires in Agent Price Researcher via `https://aprapi.dev`. Async polling gets its real workout.
- **Phase 5:** Rollback + history browser UI.
- **Phase 6+:** Automated cycler cron + shared guide library (future).

**Business constraints (non-negotiable):**
- **No end-and-relist.** Nifty handles that. Every mutation must be `ReviseItem` — the eBay item ID stays stable so Nifty’s crosslisting isn’t disrupted.
- **Nifty Quick Sync is manual.** Todd runs it himself after our batches to pull our changes back into Nifty’s master record. We do not need to auto-sync to Nifty.
- **No bulk store-categorizer here** — auto-categorize at `/admin/ebay/auto-categorize` already covers this.
- **No photo reorderer.**

**Open items to confirm before Phase 0:**
- Which service is the Agent Price Researcher actually calling for eBay sold data — SerpAPI (per README) or ScrapingBee (per Todd’s memory)? Worth checking `.env` and `src/tools/` before wiring cost accounting for it.
- Rough cost per research call (whichever service) — for the pre-batch estimator’s pass-through display.

## 9. Critical gotchas & workarounds

**Windows-mount file truncation.** The single most annoying environmental issue. When editing files via the Edit or Write tool on paths under `C:\Users\noren\found-in-alabama`, the tool sometimes reports success but silently truncates the file tail on disk. Symptom: `wc -l` shows fewer lines than expected, `tail -3` ends mid-word or mid-statement. **Fix that works:** write via Python with explicit `f.flush()` + `os.fsync(f.fileno())` + read-back verification + retry loop of 3-5 attempts with a `time.sleep(0.5)` between them. Even with fsync it can occasionally clip after the write completes — verify with `wc -l` from bash after any significant write, and if truncated, rewrite. Multiple recovery patterns were used in this thread; the reliable one is:
```python
def robust_write(path, content, attempts=5):
    for attempt in range(1, attempts + 1):
        with open(path, "w", encoding="utf-8") as f:
            f.write(content); f.flush(); os.fsync(f.fileno())
        time.sleep(0.5)
        with open(path, "rb") as f:
            actual = f.read()
        if actual == content.encode("utf-8"): return True
    return False
```

**Stale `.git/index.lock`.** After a Windows crash or aborted PowerShell git command, this file lingers and blocks all git operations. Todd’s deploy commands should ALWAYS start with:
```powershell
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
```

**Vercel 60s function timeout.** Newsletter generation was hitting this with a single Sonnet call. Current solution: two parallel Sonnet 5 calls (one per flavor) via `Promise.all`, each with `max_tokens: 5000`. If Sonnet 5’s adaptive thinking pushes total wall-time past 60s again, either bump per-call max_tokens further or disable thinking on the newsletter route with `thinking: { type: "disabled" }`.

**Neon Launch tier billing.** $19/mo, 100 GB egress. Todd was previously on free (5 GB) which he blew through and the site went down; this is why we’re on paid. Watch for anything that pulls large JSONB payloads in loops — the `haul_drafts` table stores base64 photos, so listing many drafts pulls megabytes.

**Publish cron cadence.** Runs once daily at 13:00 UTC, `PUBLISH_BATCH=1`. That means the auto-post pipeline publishes exactly ONE social draft per day across all channels combined. If Todd wants more velocity later, either bump `PUBLISH_BATCH` in `app/api/cron/publish/route.ts` or add a more frequent cron in `vercel.json`. Neither has been done yet.

**Sync-listings cron is budgeted.** `syncListingsBudgeted()` in `lib/ebay/listing-sync.ts` walks the full ~7000-item eBay store across multiple 40-second slices with a persisted cursor in `app_settings`. Runs multiple times per week via a GitHub Action (not Vercel cron).

**Categorizer uses local mirror.** `collectEligibleItems` in `lib/ebay/auto-categorize.ts` used to walk the live eBay API and would 504 on the start endpoint. It now queries the local `ebay_listings` table instead — much faster. Depends on the sync-listings cron staying fresh.

**eBay Trading API version.** Currently pinned to `1349` in `lib/ebay/client.ts`. Bumping is safe but generally unnecessary — eBay maintains long backward compatibility.

## 10. Deploy workflow

Todd runs deploys from PowerShell in `C:\Users\noren\found-in-alabama`. The pattern is:

```powershell
cd C:\Users\noren\found-in-alabama
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue

# If schema changed:
npm run db:generate   # produces new drizzle/NNNN_*.sql + updates snapshot
npm run db:migrate    # applies to prod Postgres

# Stage + commit + push
git add <specific paths>
git commit -m "<message>"
git pull --rebase
git push
```

Vercel auto-deploys on push to main. Rebuild typically completes in ~90 seconds. Journal-post changes flow through the same pipeline (GitHub Contents API commits the markdown, Vercel rebuilds).

## 11. Model selection cheat sheet

- **Sonnet 5** (`claude-sonnet-5`) — haul narratives, newsletter drafts, social copy. Where prose quality matters. `DRAFT_MODEL` in `lib/claude.ts`.
- **Haiku 4.5** (`claude-haiku-4-5-20251001`) — eBay auto-categorization (`lib/ebay/categorize.ts` — constant `CATEGORIZE_MODEL`) and "See similar items" picking (`lib/items/similar.ts` — constant `HAIKU_MODEL`). Cheap classification.
- **Cost:** currently in Sonnet 5 intro window ($2/$10 per M through 2026-08-31), reverts to $3/$15 after. New tokenizer produces ~30% more tokens for same text.

For the upcoming Expert Enhance portal, we’ll additionally use:
- **GPT-4o-mini** or **Gemini 1.5/2.0 Flash** — item specifics extraction
- **Agent Price Researcher API** at `https://aprapi.dev` (not a Claude call)

## 12. Working style notes for the incoming thread

- Todd values honest recommendations over rubber-stamping. Push back if a plan is suboptimal.
- Todd wants explicit cost transparency for anything API-heavy.
- Todd prefers small phase-by-phase builds with a clear "will this work?" checkpoint before the next phase.
- Todd runs deploys himself — you don’t have git access. Provide the exact PowerShell commands.
- If you touch a file over ~100 lines, always verify on-disk state with `wc -l` and `tail -3` after writing. The mount will bite you.
- Task list can drift long — don’t hesitate to close out completed items to keep it readable.

## 13. Where to look for full history

- **Human-readable transcript of this build thread:** `C:\Users\noren\found-in-alabama\thread-transcript.md` (~730 KB, 482 conversation turns, tool calls stripped for readability)
- **Raw JSONL logs (everything):** the two files under `C:\Users\noren\AppData\Roaming\Claude\local-agent-mode-sessions\...\.claude\projects\...\*.jsonl` — 47 MB pre-compaction + 3.8 MB current. Ground truth if you need to audit exactly what happened.

---

*End of handoff. Good luck.*
