# Phase HIP-1 + HIP-2 setup checklist — HipPostcard in the delist loop

What's new: HipPostcard is the fourth venue. Every 15 minutes the site
polls Hip's API for paid sales. For each new sale it asks eBay live who
won the race:

- **eBay still active → Hip wins.** The eBay listing is ended by API
  within seconds, the mirror is decremented (both storefronts drop it),
  and a `tes_orders` row with `source = "hip"` goes into the delist queue
  — the TES Actuator extension then runs the Nifty bulk Delist exactly as
  it does for site orders, clearing Poshmark/Mercari/Depop/Etsy/Whatnot.
- **eBay already sold → CANCEL HIP ORDER.** Nothing is written anywhere.
  You get an email and a red row on `/admin/tes-orders`; cancel and
  refund on Hip (Hip's API has no cancel call).
- **No eBay id / multi-quantity / eBay unreachable → flagged for you**,
  never automated blind.

Matching is exact: Hip's listing object carries `external_id` = the eBay
item number for everything Sync with eBay imported. Titles are only a
last-resort fallback; SKUs (bin numbers) are never a key.

**HIP-2 is in this drop too (the other direction):** whenever an eBay
item zeroes in the mirror — the 15-minute events sync, a site sale's
Stripe webhook, or the daily sweep's reconciliation — the matching Hip
listing is closed by API (`lib/hip/close.ts`, 404 = already gone). Hip's
own "Sync with eBay" stays ENABLED for imports and as a second remover;
its Hip→eBay half (the weekly report upload) is now unnecessary.

Everything below was already applied to your working folder by Cowork.
Your part: get the API key, migrate, set env vars, place the workflow,
deploy, reload the extension, run the map refresh, test one sale.

## 0. Get the Hip API key (blocker — Hip issues these by email)

The docs' "Get Your API Key" page says: contact admin@hipecommerce.com
with a brief overview of intended usage. A draft is waiting in your Gmail
("API key request — HipPostcard seller colporteurbooks"). Send it.
Keys are per site — this one is for hippostcard.com only.

Until the key lands, `/api/cron/hip-sales` answers `{configured:false}`
and does nothing; everything else can be deployed now.

## 1. What changed (for your review)

**Schema (`db/schema.ts`):**
- `tes_orders` gains `source` (`tes` | `hip`, default `tes`) and
  `hip_sale_id`, plus an index on `source`.
- New `hip_listings` — Hip id ↔ eBay item id map (`external_id`,
  `private_id`, title, price, qty, active/closed, `last_seen_at`).
- New `hip_sales` — every Hip sale seen, with `decision`
  (`hip_wins | cancel_hip | manual_match | manual_qty | unverified |
  mixed`), a `reason`, per-line detail in `lines` (jsonb), the linked
  `tes_order_id`, and `handled_at` for the board.
- New `hip_actions` — audit log of every write (`end_ebay`,
  `decrement_mirror`, later `close_hip`).

**Lib:**
- `lib/hip/client.ts` — Hip REST client (X-ApiKey, paging, rate-limit
  warning, `findPaidSales`, `getListing`, `findActiveStoreListings`,
  `closeListing` where 404 = already gone, `ebayItemIdFromHip`).
- `lib/hip/ingest.ts` — the poller: cursor in `app_settings`
  (`hipSalesCursor` = last clean run; every tick re-reads the last 7 days of created sales because Hip filters on created time and buyers can pay late; idempotent on `hip_sale_id`),
  per-line decision, `EndFixedPriceItem`, mirror decrement, queue insert,
  Resend email ("CANCEL HIP ORDER" / "HIP ORDER NEEDS YOU" / "delist
  running").
- `lib/hip/listings.ts` — `refreshHipListingMap()` (walks active store
  listings at 100/page; retires rows not seen) and
  `reconcileHipAgainstMirror()` (HIP-2 daily catch-all: closes Hip
  listings whose eBay item is sold out in the mirror; reports drift for
  eBay ids the mirror doesn't know rather than closing them).
- `lib/hip/close.ts` — `closeHipForItems(itemIds, origin)`: best-effort,
  swallowed errors, logged to `hip_actions` as `close_hip`. Called from
  `lib/ebay/events-sync.ts` (zeroed ids), the Stripe webhook (sold-out
  lines), and the sweep reconciliation.
- `lib/ebay/calls.ts` — `endFixedPriceItem()` (1047 "already ended" =
  success) and `getLiveItemStatus()` (active / ended-with-sale /
  ended-without-sale / gone / unverified).

**Routes:**
- `GET /api/cron/hip-sales` — the poller (CRON_SECRET or admin session).
  Returns 207 when a sale errored (cursor not advanced).
- `GET /api/cron/hip-map` — map refresh + HIP-2 reconciliation
  (`?reconcile=0` to only refresh).
- `GET /api/tes/delist-queue` now includes `source` + `hipSaleId` per
  order (extension reads them for labels only).
- `POST /api/admin/hip-sales/[id]/handled` — board acknowledge toggle.

**Board (`/admin/tes-orders`, now "Orders & delists"):** a red "Hip sales
need you" section at the top (decision pill, per-line reasons, eBay +
Nifty + Hip links, Handled button); Hip orders in the main list carry a
blue `HIP #id` badge.

**Extension (`chrome-extension-tes-delist/`, v0.3.4 → v0.4.0):** log and
notification lines say `Hip #id` vs `TES`. No behaviour change — the
Nifty Delist path is identical. Reload it on chrome://extensions.

## 2. Migrate

```bash
npm run db:generate   # emits ALTER tes_orders + CREATE hip_listings / hip_sales / hip_actions
npm run db:migrate    # applies to prod Postgres (Neon)
```

Sanity-check the generated SQL: it should add two columns + one index to
`tes_orders`, create three tables, and nothing else.

## 3. Env vars (Vercel → Production; also .env.local if you run locally)

```
HIP_API_KEY=<from Hip's email>
HIP_USERNAME=colporteurbooks
```

(`HIP_API_BASE` is optional; defaults to https://www.hippostcard.com/api.)

## 4. Workflow (placed by hand — .github/workflows is protected)

- Copy `scripts/workflows/hip-sales-cron.yml` →
  `.github/workflows/hip-sales-cron.yml`.
- Paste the step in `scripts/workflows/hip-map-step.yml` into
  `.github/workflows/sync-listings-cron.yml` after the sweep step.

## 5. Deploy

```bash
git pull --rebase
git add -A
git commit -m "Phase HIP-1 — HipPostcard sales poller → eBay end + Nifty delist queue; Delist board"
git push
```

## 6. First run, once the key is in Vercel

1. Signed in as admin, open
   https://www.foundinalabama.com/api/cron/hip-map?reconcile=0 — expect
   `refresh: {configured:true, seen:~1110, withExternalId:~1110}`. If
   `withExternalId` is far below `seen`, tell Cowork: Hip isn't filling
   `external_id` the way its docs say and the title fallback is carrying
   the load. Then open it again WITHOUT `?reconcile=0`: `reconcile`
   reports how many active Hip listings eBay already considers sold out
   and closes them (this is the first real HIP-2 pass — expect a handful
   if Hip's sync has been missing things).
2. Open https://www.foundinalabama.com/api/cron/hip-sales — expect
   `{configured:true, fetched:0, newSales:0}` (or your real sales since
   yesterday, each decided).
3. Buy one cheap card from your own Hip store with a second account
   (same drill as the TES-3 test). Within 15 min: eBay listing ended,
   card gone from theephemeralstate.com, email "Hip order … delist
   running", extension log "Hip #…", Nifty row delisted, order green on
   the board. Then cancel/refund the test order on Hip.

## 7. Until then — interim routine for a Hip sale

Search the title in Nifty. If eBay already shows Sold → cancel the Hip
order. Otherwise tick → bulk-bar Delist → confirm (ends eBay + every
Nifty venue; the sites drop it within 15 min). Skip Hip's report upload.

## What HIP-3 adds next

The board gets Working (amber) and Done (green, 30-day log from
`hip_actions`) sections with timestamps per automated step, and a
Hip-drift list from the reconciliation (active on Hip, unknown to eBay).
