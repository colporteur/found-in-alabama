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
- **Cron (since 2026-09-10, Vercel Pro):** ALL heartbeats are Vercel Crons in `vercel.json` — publish */15, sync-events */15, enhance */5, categorize */10, sync-listings every 4 min during the 09:00 UTC hour (15 passes walk the store), ebay-sales Mon 14:00. The `.github/workflows/*-cron.yml` files are `workflow_dispatch`-only now (manual fallback). Vercel sends `Authorization: Bearer $CRON_SECRET` itself.
- **Storefront caching (since 2026-09-10):** every public storefront page (FIA `/`, `/shop/*`; TES home, `/states`, `/types`, `/shop/[category]`, `/item/[itemId]`) is ISR with `revalidate = 600`. `lib/storefront-cache.ts` → `revalidateStorefront()` purges on demand from sync-events (anything updated), the full sweep (completion), the categorize cron, and the tes-discount / tes-featured admin routes. WHY: crawlers walking ~7,000 force-dynamic item pages were 99% of Vercel Fluid CPU (6h19m vs a 4h Hobby cap; usage stepped up the day TES launched, Aug 17). `tesPrefix()` no longer reads `headers()` (that call alone forced every TES page dynamic) — it is a constant ""; the `/tes/*` preview path on foundinalabama.com now 301s to theephemeralstate.com (middleware). Local TES preview: `http://tes.localhost:3000`. If a page must stay per-request (search, cart, checkout) it keeps `force-dynamic`; never call `headers()`/`cookies()` from a storefront page or a shared TES component or the cache silently turns off.

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
- AI Gateway: `AI_GATEWAY_URL`, `AI_GATEWAY_TOKEN` — all LLM calls route through the ai-gateway Worker (OpenRouter) as of 2026-07-09; replaces `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` for chat calls (see `lib/gateway.ts`). Model constants are gateway ALIASES (`fia-drafts`, `fia-social`, `fia-cheap`) — the real models are set in the gateway routing table via Admin → AI Models.
- AI Gateway admin: `AI_GATEWAY_ADMIN_TOKEN` — the gateway's ADMIN_TOKEN; powers the Admin → AI Models routing-table editor (`/api/admin/ai-models`). Server-side only.
- OpenAI: `OPENAI_API_KEY` — still required, but ONLY for audio transcription (`/api/admin/draft/transcribe`); OpenRouter doesn't proxy the audio API
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

**P5 SHIPPED (2026-09-01): `supply_reprice` — supply-aware repricing of live listings.** Built as an ENHANCE OP rather than the standalone sweep extension the dev list first sketched, because the batch queue, per-job before/after snapshots, rollback and mirror sync already exist here. `lib/enhance/supply.ts` holds the whole decision, free of I/O and unit-tested: `buildSupplyQuery()` (ported from Nifty content.js — strips publisher/process names, grades, sizes and serials, keeps 7 identity tokens with the format word last, sets eBay category 262042 for postcards), `fetchSupply()` (GET `${AI_GATEWAY_URL}/v1/supply`, 6h KV cache on the worker side), and `decideReprice()`. **The bias runs against the markdown reflex**: a stale card with NO competition is usually UNDERpriced, so RAISE is the primary action. Sole/none/adjacent band + price under `raiseUnder` ($12) → raise to the similar-item median, capped at `maxRaiseFactor` (3x) and rounded to Todd’s .87. Crowded band AND price above `crowdedFactor` (1.25) x the same-item median → lower TO that median, never below it, never below `floor` ($5.87). THIN (1–4 competitors) always holds — undercutting a thin market is how the floor got here. `minAgeDays` (60) gates on `ebayListings.startTime`; an unknown start time passes. **`dryRun` defaults TRUE and must be explicitly opted out of** — a report run does every lookup and records action/band/counts/medians/anchor/reason per job with before+after prices, so the job list reads exactly like a real run before anything is revised; the form’s checkbox turns red when it is off. The batches route refuses a `supply_reprice` with no item selection, category, title or SKU filter. Tests: `lib/enhance/supply.test.mts`, 21/21 (`npx tsx lib/enhance/supply.test.mts` on Windows). One inherited bug fixed in both copies while porting: the serial-stripping regex ate decade tokens, so "1950s" was being dropped from the query — Nifty content.js has the same fix.

**D4 SHIPPED (2026-09-01): the guide library now comes from the AI gateway.** `lib/enhance/guides.ts` was rewritten: `listGuides()` / `listGuideFamilies()` / `loadGuide()` are **async** and read `GET /guides` and `GET /guides/<id>` from `AI_GATEWAY_URL` (6h in-process cache, `clearGuideCache()` to reset). That endpoint merges manifest v2 metadata — family, parent, stage, keywords, priority, description — into every row and returns the canonical `families` array, so the whole 31-guide library is available here, not the frozen five. `content/expert-guides/` stays in the bundle as an OFFLINE FALLBACK only (rows are labelled family "Bundled (offline)"); do not delete it. The guide picker on the Enhance batch form and the Workbench groups options by family and adds an `▸ All <family> (auto-route per listing)` entry whose value is `family:<Name>`. With that selected, `resolveGuideForJob()` runs the tier-0 router (ported from Nifty v1.42: family gate → parent → best child by manifest keywords) against the live title + eBay category **per job**, so one batch can span a whole family; the chosen guide is recorded as `result.routedBy`. Trade-off: a varying `cacheableSystem` prefix costs some Anthropic prompt-cache hits — the form says so, and picking a single guide keeps the old behaviour exactly. `item_specifics` now accepts an OPTIONAL `config.guideId` and injects only the guide’s `ITEM SPECIFICS MAP` section (`guideSection()`), capped at 4k chars, when the guide has one. Batch validation in `app/api/admin/enhance/batches/route.ts` accepts either form. Tests: `lib/enhance/guides.test.mts` (run `npx tsx lib/enhance/guides.test.mts` on Windows) — 10/10 covering santa vs Santa Fe, the family gate, parents-only fallback and section extraction.

**Phase 4 SHIPPED (2026-07-01): price research reprice via APR.** Queue gained a "waiting" outcome: async jobs go back to pending with merged result state, re-claimed on a LATER tick (in-tick skip list prevents spin; 50-wait cap ≈ 4h timeout). `price_research` handler: submit tick POSTs `/api/v1/research` (X-API-Key, `idempotency_key: enhance-{jobId}` so crash resubmits don't double-bill, billable $0.03) and stashes `aprJobId` in job.result; later ticks poll unbillably; on complete applies anchor price (recommended p75 default / median) with floor + round-to-.87 + optional max-change-% guardrail (over-cap suggestions recorded in result as `suggestedPrice`, job skipped for manual review). In-flight cap 3 concurrent APR submissions per batch. Tunnel down / PC asleep → waiting-retry, not failure. **Env needed: `APR_API_URL` (default https://aprapi.dev) and `APR_API_KEY` (= APR's INTERNAL_API_KEY) in Vercel + `.env.local`.** Also fixed this session: gemini-2.0-flash was shut down by Google 2026-06-01 — defaults now gemini-2.5-flash (2.5 family sunsets 2026-10-16, noted in pricing table).

**Phase 5 SHIPPED (2026-07-01): rollback + history browser.** All three grains (decision #4). Engine in `lib/enhance/rollback.ts`: `rollbackEligibility` (blocks truncated ≥20k description snapshots; per-op snapshot checks) + `rollbackJob` (live Active check, op-appropriate ReviseItem restore, mirror sync, rolledBack flag + result.rolledBackAt; failures stored as result.rollbackError without clobbering job history) + `rollbackSlice` (time-budgeted batch/24h-window processing). item_specifics rollback REMOVES the specifics we added — but only those whose live value still equals what we wrote; hand-edited values survive. Routes: POST `/api/admin/enhance/jobs/[id]/rollback`, `/batches/[id]/rollback` (35s slices, client loops until remaining=0 — auto-categorize advance pattern), `/rollback-session` ({hours}, capped 7 days). UI: per-job Roll back buttons + rolled-back badges on batch detail, Roll back batch in header, history browser at `/admin/ebay/enhance/history` (latest 200 jobs cross-batch, op filter chips, session rollback button), linked from the dashboard. No schema change (rolledBack column existed since Phase 0).

**Workbench W1 SHIPPED (2026-07-01):** `/admin/ebay/workbench` — all active eBay inventory (mirror-based) with thumbnail/title/SKU/price, SQL SKU-schema classifier (`lib/enhance/sku-class.ts`: bin NA###, vinyl "RPM YYMMDD", media YYMMDD, named bins, card_legacy `367-m7qgb`, plain-number card, oversize = literal "Apps", none, irregular = cleanup worklist), natural SKU sorting, filters (text/class/category/price + wiggled/substantive "never"/30/60/90 days), 100/page. Schema (migration 0018 needed): `ebay_listings.last_wiggle_at` + `last_substantive_at`, stamped by queue.ts on COMPLETED jobs only (WIGGLE_OPS / SUBSTANTIVE_OPS consts in db/schema.ts); one-time idempotent backfill from job history at GET `/api/admin/enhance/backfill-last-actions`.

**Workbench W2 SHIPPED (2026-07-01): checkbox action layer.** `WorkbenchGrid.tsx` (client): per-row checkboxes in two column-sections (Wiggles: $ + SKU; Substantive: Spec/Title/Desc/APR), header checkboxes toggle the page per op, sticky toolbar shows per-op counts + Apply buttons. Apply modal: per-op compact config (same fields as batch form; sku_rename uses the new "set" mode = assign exact SKU to every checked item, `{ mode:"set", replace }`, requires explicit itemIds — server-enforced), per-op "apply to ALL N matching current filter" checkbox (resolved via GET `/api/admin/workbench/item-ids`, cap 5000, exact same filter builder as the page: `lib/enhance/workbench-query.ts`). Creating batches auto-kicks the queue. All batches labeled "Workbench: <op>" and flow through the normal preview-less explicit-ids path, queue, cost tracking, history, rollback. Note: op configs in the modal are shared across ops per apply (one price delta, one guide per remix op).

**Audio haul seeding SHIPPED (2026-07-01):** "Speak your haul" on `/admin/draft` — record in-browser (MediaRecorder, AAC on iOS / webm elsewhere) or upload a voice memo → POST `/api/admin/draft/transcribe` → OpenAI `gpt-4o-mini-transcribe` (~$0.003/min; NOTE: verify model still live if errors — same deprecation risk as gemini) → Haiku split into acquisitionStory/photoNotes/city/state/vagueLocation (split-only prompt, never invents; falls back to verbatim transcript in the story field if the split fails) → fields append/fill in the form for review before Generate. Audio never stored; ~4-min cap (Vercel 4.5MB body). Component: `app/admin/draft/AudioStory.tsx`.

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

**Publish cron cadence (reworked 2026-07-03; superseded 2026-09-10 by Vercel Crons — see §3).** GitHub's */15 social-cron schedule actually fires ~every 2 hours (observed), which starved both publishing (was 1 post/tick) and generation (only ran on idle ticks). Now: each tick publishes due drafts until a 38s budget is spent (BlueSky ~2s each, Publer up to ~40s), then runs one auto-generation whenever <32s have elapsed — no more idle-tick gating. Generation budgets doubled (2 new-item + 2 recycle/day; `lib/social/auto-generate.ts`). `SOCIAL_DISABLED_CHANNELS` env (comma list, currently should be "pinterest") pauses channels: auto-generation skips them and the scheduler leaves their drafts unscheduled — clear the var when Pinterest's API approval lands, then bulk-retry the failed pile. UTM tracking: `postDraft()` appends utm_source=channel, utm_medium=social, utm_campaign=contentType to every posted link — visible in Vercel Web Analytics. Auto sale announcements: the weekly ebay-sales cron enqueues one factual, template-based (no LLM) announcement draft per sale it creates (`lib/ebay/sale-announcements.ts`, idempotent per tier+start-date, channel rotated by tier hash, scheduled at sale start).

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

## Mail — assigned addresses + site inbox (Phase MAIL-1, Oct 2026)

`/admin/mail/addresses` creates addresses on foundinalabama.com and
theephemeralstate.com (both zones are on Cloudflare). Each address is a
Cloudflare Email Routing rule, pushed by the API the moment it's saved:

- **Site inbox** → rule sends to the `fia-inbox` Email Worker
  (`cloudflare/fia-inbox-worker.js`) → `POST /api/email/inbound` (Bearer
  `EMAIL_INBOUND_SECRET`) → `email_messages` → read at `/admin/mail`.
- **Forward only** → native Cloudflare forward rule; never touches the site.
- **Site inbox + forward** → worker rule; site stores a copy and replies
  `{forwardTo}`, the worker forwards.

Forward-to addresses must be verified Cloudflare destinations; the page adds
them and Cloudflare emails the verification link. The worker falls back to
`FALLBACK_FORWARD` when the site errors or a message exceeds ~4 MB, so mail
isn't lost. Messages keep the raw RFC 822 (`raw_base64`) for .eml and
attachment download; no delete, archive only. "Import existing from
Cloudflare" adopts rules made in the dashboard (read-only toward Cloudflare).
Code: `lib/email/{rules,cloudflare,addresses,inbound}.ts`,
`app/api/admin/email/*`, `app/api/email/inbound`, `app/(fia)/admin/mail/*`,
migration `0027_mail`, tests `scripts/email-rules.test.cjs`.
Env: `CLOUDFLARE_API_TOKEN`, `EMAIL_INBOUND_SECRET` (optional
`EMAIL_DOMAINS`, `EMAIL_INBOX_WORKER`).

## Buy direct on foundinalabama.com (Phase FIA-SHOP-1, Oct 2026)

FIA now sells directly with Stripe, reusing the TES order pipeline. Orders
are `tes_orders` rows with `source = "fia"`, so the shared Stripe webhook
(`/api/tes/stripe-webhook`, keyed on `metadata.tesOrderId`), the delist
queue + Nifty extension, the orders board (FIA badge) and the Pirate Ship
export/tracking import all handle them. eBay and the other marketplaces stay
linked from every product page.

- **Weights:** the full sweep copies each listing's `ShippingPackageDetails`
  (or `CalculatedShippingRate`) into `ebay_listings.pkg_weight_oz` /
  `pkg_length_in` / `pkg_width_in` / `pkg_depth_in` / `pkg_irregular`
  (`readPackageInfo()` in `lib/ebay/listing-sync.ts`). Fills on the next
  daily sweep. If `/admin/fia-shop` shows ~0% coverage after a sweep, eBay
  isn't returning package details in GetSellerList and a GetItem backfill is
  needed.
- **Shipping:** `lib/fia/shipping.ts` (pure, tested in
  `scripts/fia-shipping.test.mts`). Cart weight = Σ unit weights − a
  packaging credit per extra unit (never below the heaviest unit). Media Mail
  table when EVERY line's eBay listing offers Media Mail (`shipping_services`
  contains "Media"), else Ground Advantage. Missing weight → per-ship-class
  fallback. Items over the weight/side caps are eBay-only (no Add to cart).
  All of it — tables, handling, free threshold, caps, fallbacks — is in
  `app_settings.fiaShipSettings`, edited at `/admin/fia-shop`.
- **Price:** `app_settings.fiaGlobalDiscountPercent` ("X% below eBay",
  separate from TES); never stacks with an eBay sale, the bigger wins.
- **Code:** `lib/fia/*` (settings, catalog = shared per-item facts, orders =
  cart resolver, item-detail), `/api/fia/quote`, `/api/fia/checkout`,
  `/api/admin/fia-shop`, pages `app/(fia)/item/[itemId]`, `/cart`,
  `/checkout/success`, `/admin/fia-shop`. `CartProvider` takes a
  `storageKey` (FIA uses `fia_cart_v1`); `ItemGallery` takes `theme="fia"`.
- **No sales tax** is collected on either site (Todd's call, Oct 2026).
  Turning on Stripe Tax later = `automatic_tax: { enabled: true }` on both
  checkout routes plus his Alabama registration in the Stripe dashboard.

## Item registry (Phase REG-1, Oct 2026)

First phase of the Integrated Resale System (scope doc lives in the "Vibecoding Reselling Tools" Claude project). One record per physical item, with every venue listing for it.

- **Tables (migration 0029, additive only):** `registry_items`, `venue_listings`, `registry_review`, `venue_status`. Nothing else reads them yet.
- **Sync:** `lib/registry/sync.ts` → `runRegistrySync()`. It's an ordered list of idempotent SQL steps that read `items` (Nifty capture), `ebay_listings` and `hip_listings`, and write only the registry tables. Runs hourly (`/api/cron/registry-sync`, `40 * * * *`) and from the "Run sync now" button.
- **Capture hook:** `/api/admin/items/capture` calls `syncRegistryFromCapture()` after each batch, recording Nifty's per-venue status (LISTED → live, SOLD → sold, DELISTED → ended). The hook swallows its own errors, so a capture never fails because of the registry.
- **Admin page:** `/admin/registry` (linked from the dashboard under Data & setup) shows totals, cross-venue coverage, venue status and the review queue. Dismissed review rows survive syncs.
- **Gotchas:**
  - `ebay_listings.quantity` is AVAILABLE quantity. eBay keeps sold-out qty-1 listings open until their end time, so "for sale" means quantity > 0.
  - SKU is a bin, not an identity.
  - Venue listing ids are stored URL-decoded (Whatnot ids are base64 and end in `=`).
  - The eBay mirror only adds brand-new listings at the daily sweep. Items listed today show in the "Nifty listed, eBay not in mirror" review bucket until then.
- **Nifty Sync extension:** the bulk capture's 400-page cap (= 10,000 items) was raised to 2,000 pages on Oct 7. Locally patched in `chrome-extension/popup.js` and committed with this phase.

## Sale detection, shadow mode (Phase SALES-1, Oct 2026)

Second phase of the Integrated Resale System. Notices every sale on every venue, ties it to its registry item, records which other listings should come down, and checks whether Nifty took them down. **It never delists anything** — Nifty still does all of that. The scoreboard is the readiness test for the later phase that replaces Nifty's delisting.

- **Tables (migration 0030, additive only):** `sale_events` (one row per sale signal, unique on source + source_ref + line), `delist_plans` (one row per listing that should come down, with its outcome), `sale_email_scans` (which inbox messages the parser has read), `nifty_alerts` (Nifty's failure / reconnect notices).
- **Signals:**
  - eBay — hook in `lib/ebay/events-sync.ts`: a listing whose available quantity hits 0 with QuantitySold > 0 is a sale (a manual end has QuantitySold 0). Calls `recordEbaySales()`, which never throws.
  - Hip — `hip_sales` lines. TES / FIA — paid `tes_orders` (source tes / fia; Hip orders come in through `hip_sales`).
  - Mercari / Poshmark / Depop / Whatnot / Nifty — sale emails forwarded from Gmail to `sales@foundinalabama.com` (Site inbox), parsed by `lib/sales/parse.ts`. Buyer names and addresses are never extracted; they stay only in the stored message.
- **Pipeline:** `lib/sales/pipeline.ts` → `runSalesSync()`, every 5 minutes (`/api/cron/sales-sync`) and from "Run now" on `/admin/sales`. Steps: ingest → match (listing id → eBay id → exact title → title prefix for Depop's shortened titles; ties go to review, rules in `lib/sales/match.ts`) → plan → Nifty alerts → outcomes.
- **Registry writes:** a matched sale marks the registry item sold, and the selling venue's listing sold. Multi-quantity eBay stock stays live. `lib/registry/sync.ts` has guards (`expandSaleGuards`) so the hourly sync doesn't flip a just-sold item back to live from an older Nifty capture or eBay mirror row, and doesn't assume-close a listing that's a planned delist leg (its real status is what the score is waiting for).
- **Outcomes:** eBay from the mirror, Hip from `hip_listings`, the other venues from the next Nifty Sync capture (per-venue DELISTED / SOLD). A Nifty "Failed auto-delist" email marks that leg `failed_nifty`. Legs with no evidence after 24 h are `unverified`.
- **Older sales:** anything more than 3 days old when first matched (the 45-day Hip/Stripe lookback, a Gmail backfill) is recorded for history only: no delist plan and no registry change. Its title match prefers the item already recorded as sold on that venue, so an old sale can't mark a live relist sold.
- **Review:** `/admin/sales` review queue. Pick a candidate, type an eBay item id / URL / registry id, or Ignore (`/api/admin/sales/review`).
- **Tests:** `npx tsx --test lib/sales/parse.test.mts lib/sales/match.test.mts`. Fixtures are redacted reconstructions — never paste a real buyer's details (public repo).

## Listing intake + drafts (Phase LIST-1, Oct 2026)

First step of Phase 3 (push-button listing, own listing writer). Items get from the PC into the app as **listing drafts**; the writer, review/approve and the Nifty bridge come in LIST-2/3. Nothing here publishes anywhere.

- **Tables (migration 0031):** `listing_drafts` (one per item; status `uploading → ready → generating → review → approved → published`, or `sent_back` / `discarded`), `draft_photos` (R2 key, public URL, order, role, sha256). Each draft creates a `registry_items` row at intake (status `draft`, created_from `intake`), so the item id exists before any text is written. Discard → registry item `archived`.
- **Photo storage:** Cloudflare R2 via `lib/storage/r2.ts` (S3 API, path-style, automatic checksums off so presigned PUTs work). Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE` (custom domain `photos.foundinalabama.com`). Keys are `drafts/<draftId>/<NN>-<sha12>.<ext>`.
- **API:**
  - `POST /api/admin/listings/intake`: Bearer API key from `/admin/api-keys` (the PC sender) or a signed-in session (manual lister). Validated by `lib/listings/validate.ts`. Idempotent on (source, sourceRef); `replace: true` swaps photos while still `uploading`/`ready`. Returns presigned PUT URLs (PC) or per-photo POST routes (browser).
  - `POST /api/admin/listings/:id/photo?position=N`: browser upload through the app; sha256 must match.
  - `POST /api/admin/listings/:id/complete`: HEADs each object; all present → `ready`.
  - `PATCH` / `POST /api/admin/listings/:id`: hand edits, discard/restore (session only).
- **Admin:** `/admin/listings` (queue with status filters), `/admin/listings/new` (manual lister: photos are resized in the browser to ≤3,200 px and kept under the 4.5 MB request limit; "let the writer fill it" vs "I'll write it myself" is stored as `facts.mode`), `/admin/listings/:id` (photos, intake facts, editable fields).
- **PC side (not in this repo):** `PhotoXfer/listing_sender.py`, hooked into `scans_web.py` / `scans.html`, adds "Send checked to listing" and a per-item "Send" button to the Scans page. It reads photos only, never moves, rotates or deletes anything, and records what was sent in `PhotoXfer/listing_sent.json`. The API key lives in `PhotoXfer/fia_api_key.txt`. Tests: `PhotoXfer/test_listing_sender.py`.
- **Sale matcher:** draft/archived registry items are excluded from title matching (`lib/sales/pipeline.ts`).

## Listing writer + review queue (Phase LIST-2, Oct 2026)

- **What it does:** `lib/listings/writer.ts` `generateDraft(id, {tier, corrections, who})` writes one draft and leaves it in `review`. Steps:
  1. **identify**: quick vision pass on up to 3 photos with the identify model. Returns kind, card type, keywords, rough value and difficulty.
  2. **route**: `pickTier()` in `lib/listings/rules.ts`. Artwork, signed, ≥$75 or hard items go to premium; common postcards and simple paper to simple; everything else to general.
  3. **context**: up to two matching Expert Guides (listing + pricing sections only, `guidePromptText`), a live supply snapshot (`/v1/supply` on the gateway, active eBay asks), and the 40 best-fitting eBay categories from the ones the store already uses (`ebay_listings.site_category_*`).
  4. **write**: the tier's model returns JSON (title, plain-text description, condition, category id, item specifics, price and range, rationale, confidence, flags). If confidence is below `retryBelow`, it runs once more one tier up and keeps the more confident result. There is no retry when a tier was chosen by hand.
  5. **rules**:
     - titles: 80 characters, bin codes stripped, "Vtg" only if needed
     - descriptions: plain text, 1,500 cap, the first ~1,000 characters stand alone
     - prices: nearest .87, $5.87 floor (RPPC $9.87, early cards $7.87), postcards at $20–$24 go to $19.99, Poshmark price $15 below that
     - shipping: Standard Envelope only for ESE-eligible categories at ≤$20 and ≤3.5 oz; books and media go Media Mail
- **Photos** are fetched from R2 and downsized with `sharp` (long edge 1,568 px) before they go to the model, so big scans never hit image limits.
- **Claiming:** a run sets `status='generating'` atomically. A run older than 10 minutes counts as crashed and can be retried. A failed run restores the previous status and stores `generation_error`. A draft discarded mid-run is not overwritten.
- **Records (migration 0032):**
  - `ai_runs`: one row per model call, with step, tier, model, resolved model, guide ids and versions, tokens, cost, confidence, parsed output and errors.
  - `listing_drafts` gains `ai_meta` (what the writer used and decided), `shipping_profile`, `generation_started_at`, `generation_error` and `approved_by`.
  - Every call is also in `ai_call_log` (ops `listing_identify` / `listing_write`), sent with `x-app: listing-writer`.
- **Settings:** `/admin/listings/settings`, stored in app_settings `listingWriter`:
  - model per tier (OpenRouter ids or gateway aliases). Defaults: simple `anthropic/claude-haiku-4.5`, general `anthropic/claude-sonnet-5`, premium `anthropic/claude-fable-5`, identify `anthropic/claude-haiku-4.5`
  - photos sent (6), retry threshold (0.6), floors
- **Review:** `lib/listings/review.ts`.
  - Approve needs a title, description, price and condition.
  - Bulk approve, unapprove, and send back with a note. On the next write the note becomes the writer's corrections.
  - Approval only marks the draft. Nothing publishes yet; that comes in LIST-3, the Nifty bridge.
- **API:**
  - `POST /api/admin/listings/:id/generate` (session or API key, `maxDuration` 300)
  - `POST /api/admin/listings/bulk` (`approve` | `writable`)
  - `GET/PUT /api/admin/listings/settings`
  - `POST /api/admin/listings/:id` now also takes `approve`, `unapprove` and `send_back`
- **Admin UI:**
  - The queue has "Write all ready". It runs in the browser, two at a time; manual-lister drafts marked "I'll write it myself" are skipped.
  - Queue cards show a confidence badge and have checkboxes; there are "Pick confident (≥ 80%)" and "Approve selected" buttons.
  - The draft page has Write / Rewrite (choose the tier and type corrections), Approve / Send back, and the writer's notes: model, cost, guides, price reasoning, supply comps and flags.
- **Not yet:** APR sold comps (APR runs on the PC). Prices use the guide plus active supply for now.
- **Tests:** `npx tsx --test lib/listings/rules.test.mts`.

## Nifty bridge (Phase LIST-3, Oct 2026)

- **What:** approved listing drafts are created in Nifty as **drafts** (no "Generate", no credits, nothing published) by the FIA Nifty Sync extension's **Send approved to Nifty** button (`chrome-extension/nifty-bridge.js`, v1.2.0). It runs in Todd's signed-in app.nifty.ai tab, because Nifty's API (tRPC at `api.nifty.ai/api/v1`) authenticates with the browser session.
- **Nifty API notes (private, observed Oct 8 2026):**
  - Reads: `inventory.getInventoryItem {inventoryItemId, mode:"edit"}`, `taxonomy.getMarketplaceTaxonomy {marketplace, categoryId, sections:"ALL_SECTIONS", includeGlobal:true}`, `taxonomy.getCategories {marketplace, query}`, `taxonomy.loadDynamicProvider` (eBay store categories).
  - Write used: **`inventory.saveAsDraftV2`** — same body as the item response (media, inventoryItem, marketplaceListings, inventoryItemId) plus `lifecycleStatus` (`IN_PROGRESS` | `READY_TO_LIST`); returns `{draftId}`.
  - **Never `inventory.addItemV2`:** despite its `isDraft` field it is Nifty's Publish. A test on Oct 8 listed the Terminal Tower brochure on all five venues (Todd kept it). The bridge's fetch wrapper refuses any write except `saveAsDraftV2`, and after saving it re-reads the item and stops if any venue shows `LISTED`.
- **Templates:** fixed marketplace settings (shipping, returns, payment, offers, Mercari/Depop/Whatnot shipping, Poshmark size, venue categories) are copied from one existing Nifty listing per kind. The kinds are postcard, photo, paper (envelope / calculated), book, media and general. They're editable at `/admin/listings/settings` and stored in app_settings `niftyTemplates`; `pickTemplateKey()` in `lib/listings/nifty.ts` picks the kind. From the template only SHIPPING / PRICING / SIZE sections and required fields are kept; SPECIFIC / BRAND / COLOR / TAGS describe the template's own item and are dropped.
- **From the draft:** title, description, condition (mapped to Nifty's NEW / LIKE_NEW / … / GOOD / FAIR), condition note (eBay only), price, Poshmark price, SKU (bin), private notes (`FIA <id8> | SKU: …`), photos (sent as `external` pictures pointing at photos.foundinalabama.com; Nifty copies them to its own storage), eBay category (looked up by path), eBay item specifics (matched by field name; values that don't fit go to warnings), and eBay store categories.
- **Store categories:** the writer now picks up to two store shelves from `ebay_store_categories` (item shelf, then Alabama or the "Found in Other States" state shelf). Stored in `listing_drafts.store_category_ids` and editable on the draft page. Re-sync store categories in the eBay tool after changing them on eBay.
- **FIA API:** `GET /api/admin/listings/nifty-queue` (approved and not yet sent) and `POST /api/admin/listings/:id/nifty {niftyId|error, warnings}`. A successful send sets status `in_nifty`, `nifty_item_id` and `nifty_sent_at`, and copies the Nifty id to the registry item. Both routes accept the API key or a session.
- **Migration 0033:** `store_category_ids`, `nifty_item_id`, `nifty_sent_at`, `nifty_error`, `nifty_warnings` on `listing_drafts`.
- **Tests:**
  - `npx tsx --test lib/listings/nifty.test.mts lib/listings/rules.test.mts`
  - `node --test chrome-extension/nifty-bridge.test.cjs` (fake Nifty API; asserts only `saveAsDraftV2` is called)

- **Item specifics fitted to the eBay category (Oct 8):**
  - After the writer picks a category, `lib/ebay/taxonomy.ts` fetches that category's aspects from the eBay Taxonomy API. It uses an application token from `EBAY_APP_ID` / `EBAY_CERT_ID` (no user consent) and caches results for 30 days in `ebay_category_aspects` (migration 0034).
  - The aspects are names, required / recommended, pick-list vs free text, single vs multiple, and allowed values.
  - A text-only pass on the identify model then fills them from the finished listing. `fitSpecifics()` (`lib/ebay/aspects.ts`, tested) keeps only the category's own field names and allowed values.
  - Required fields still empty become review flags.
  - If eBay can't be reached, the writer's own specifics are kept, as before.

## Send to listing from Scanroom and the Estate panel (Phase 3d, Oct 2026)

- The PC side isn't in this repo. See `Scanroom/SEND-TO-LISTING.md` and `PhotoXfer/SEND-TO-LISTING.md` on the PC.
- **Scanroom:** after Save to Batch or Save by SKU Class, a **➜ Send to listing** button sends exactly the item folders that save created. It calls PhotoXfer `POST /scans/send-to-listing {folder, items}`.
- **Estate panel** (PhotoXfer `/estate`): **➜ Send to listing** sends `estate:<folder>`. Each lot (listing.json) and each single (singles.json) becomes a draft with `source: "estate"`. The sorter's title, description and price arrive as `facts.estate_title`, `facts.estate_description` and `facts.estate_price`, and the writer gets them as a draft to improve.
- **PhotoXfer listing sender:**
  - Sends are queued when one is already running (two Scanrooms, or the Scans page).
  - text/plain JSON is accepted, which file:// Scanroom needs.
  - POSTs from other websites are refused (Origin guard).

## Phase 4a — To-ship queue + pick list (Oct 9, 2026)
- Migration 0035: `ship_orders`, `ship_order_lines`. Run `npm run db:migrate`.
- `/admin/ship`: first visit asks for a start date (app_settings `fulfillment`). After that, every sale_event since that day becomes a package (Stripe orders and Hip sales grouped by order; marketplace sales one each until 4b buyer capture).
- `lib/fulfillment/sku.ts`: the Nifty Pick List sort rules (dated newest first, NA/LT highest first, named in order).
- `/admin/ship/pick?ids=…`: printable list; Print waits for photos, then records `pick_printed_at`.
- Synced on page load and after every `/api/cron/sales-sync`. Website/Hip orders become shipped/cancelled from tes_orders; everything else is marked by hand.
- Writes only FIA tables. Nothing goes to any marketplace.

## Phase 4b — Invoices, buyers, combined orders (Oct 9, 2026)
- Migration 0037: `ship_orders.order_total / shipping_paid / venue_fees`, `ship_order_lines.ebay_item_id / venue_line_id`.
- eBay orders (`lib/ebay/orders.ts`, Fulfillment API, read-only): needs scope `sell.fulfillment.readonly` — Todd re-connects at /admin/ebay/sales/connect once. Until then the queue works as in 4a and shows a banner.
  - Token refresh now asks only for the scopes already granted (`oauth.ts`), so adding a scope can't break the existing Sell API calls before the re-connect.
  - eBay's combined orders become one package (lines moved from the per-sale packages, which become `merged`); buyer, ship-to, totals, fees; FULFILLED → shipped, CANCELED → cancelled.
- One sale email = one package (Poshmark/Depop bundles). Poshmark/Depop buyer handles (and Depop ship-to name) come from the stored emails (`lib/fulfillment/buyers.ts`).
- Same buyer + venue within 7 days → "Same buyer" badge with Combine; "Combine selected" for Mercari/anything by hand.
- `/admin/ship/invoices?ids=…`: 4×6 Zebra invoices (FIA + TES for marketplaces, single brand for website orders), click-to-edit prices, Print records `invoice_printed_at`.

## Phase 4c — Inventory labels + eBay sales backed by orders (Oct 9, 2026)
- `/admin/labels`: find live registry items by title words or bin (datalist of live bins), or pick from new listings (drafts); `/admin/labels/print?k=r:<id>,d:<id>` prints DYMO 57×32 mm labels (layout of the Nifty Inventory Label Printer v3.5: shrink-to-fit title, FIA logo, price). Price = eBay listing price, else a live venue price; drafts use the draft price. Title/price click-to-edit. No migration.
- eBay sale detection (Phase 2): with eBay order access, a sell-out is recorded as `verifying` and only becomes a sale once an eBay order backs it (`verifyEbaySales`, runs before matching in sales-sync). No order after 30 minutes → `ignored`, resolved_by `no-ebay-order`. Also re-checks the last 14 days of eBay sale events (catches GTC renewals of long-sold listings whose mirror quantity was stale, e.g. the six Oct 9 ones Todd cancelled).
- To-ship queue: with eBay order access, eBay packages come only from eBay orders.

## Phase 4e — Books (Oct 9, 2026)
- Migration 0038: `acquisitions` (hauls: name, date, kind, total cost, notes), `registry_items.acquisition_id / unit_cost`, `ship_orders.shipping_cost`.
- Cost basis = item's own cost, else its haul's total split evenly, else unknown (flagged). Optional everywhere — Todd's older inventory is co-mingled.
- `/admin/books?month=` profit per package from ship_orders (so the books start on the to-ship queue's start date): revenue (items + buyer-paid shipping), fees (eBay's own from the order; estimates elsewhere, `lib/books/fees.ts`, rates editable at `/admin/books/settings`), postage ($0 for buyer-paid-label venues, typed in otherwise), item cost, profit. CSV at `/api/admin/books/csv?month=` (no buyer names).
- `/admin/books/hauls`: add/edit hauls, items tied, sold, sales so far. Listing draft page: Haul & cost panel + "Print inventory label".
- eBay-order lines now also find their registry item through venue_listings.

## Phase 5a — Shake-up report (Oct 9, 2026)
- Migration 0039: `stale_actions` (what the shake-up did to an eBay item, when).
- `lib/stale/rules.ts` (tested): every `cycleDays` (180) since the last shake-up (max of stale_actions and ebay_listings.last_substantive_at; else the earliest known date) an item is due for one action, rotating rewrite → markdown → describe → markdown; items ≤ $7.87 after 2 rounds → bundle. Settings in app_settings `staleRhythm`.
- `/admin/stale`: due counts, per-action lists (oldest first, pick N), runs through Expert Enhance (`createBatch`: title_remix + item_specifics, description_remix with `family:<Guide family>`, price_adjust percent with floor + round87). "Leave as is this round" records a skip (resets the clock, no round). Bundles: bins with ≥ 5 candidates → lot listing draft (registry draft item, singles' eBay photos, item list in notes; nothing ends on eBay).
- On prod data (Oct 9): 11,609 live eBay items, 304 due now, 41 due within 30 days.
