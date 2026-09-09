# Phase ESE-1 setup checklist — Standard Envelope audit (read-only)

The problem: live listings that ship on the **eBay Standard Envelope**
policy ("Very Small and Paper under 3.5 oz") while sitting in an eBay
category that is NOT on eBay's envelope-eligible list. This phase only
FINDS them and sorts them into two piles. Nothing is changed on eBay or in
Nifty.

The two piles (your call, 2026-09-09):

| pile | rule | fix (next phases) |
|---|---|---|
| **recategorize** | title reads as a card type (postcard/RPPC, greeting card, stamp, coin, trading card, seeds) **and** price ≤ $20 | move the eBay category to an eligible one, keep envelope |
| **reship** | everything else on the envelope policy in an ineligible category (incl. cards over $20) | switch to Calculated Shipping — the **4oz** profile |

Everything below was already written into your working folder by Cowork.
Your part: migrate, deploy, let the sweep run, download the CSV.

## 1. What changed (for your review)

- **`db/schema.ts`** — `ebay_listings` gains `shipping_profile_id`,
  `shipping_profile_name`, `shipping_services` (jsonb). Needs a migration.
- **`lib/ebay/listing-sync.ts`** — the full sweep now captures the eBay
  business Shipping policy (`SellerProfiles.SellerShippingProfile`) and the
  raw `ShippingService` codes from the GetSellerList response it was
  already pulling. No extra API calls. COALESCE on upsert, like photos.
- **`lib/enhance/ese.ts`** (new) — pure triage logic ported from the Nifty
  extension's guard: `eseEligible()` (same normalization: `>`/`:` paths,
  `&`→`and`, child-of-listed = eligible), `eseCardGroup()` (the same
  keyword rules), `isEnvelopeShipping()`, `triageListing()`.
- **`lib/enhance/ese-categories.json`** (new) — a copy of the extension's
  `ese_categories.json` (eBay xlsx, Aug 2026). Update both copies together.
- **`lib/enhance/ese.test.mts`** (new) — 25 tests, all passing.
- **`app/api/admin/ebay/ese-audit/route.ts`** (new) — the audit endpoint.

Two things the list taught us while testing: **Photographs** and **Books**
are on eBay's eligible list. So a photo or a book on the envelope policy is
fine — the offenders will mostly be Souvenirs & Travel Memorabilia, Paper >
Other, Historical Memorabilia, and the like.

## 2. Migrate the database

```powershell
cd C:\Users\noren\found-in-alabama
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
npm run db:generate   # emits ALTER TABLE ebay_listings ADD COLUMN ×3
npm run db:migrate    # applies to prod Postgres (Neon)
```

## 3. Run the tests (optional, 10 seconds)

```powershell
npx tsx lib/enhance/ese.test.mts
```

Expect `25/25 passed`.

## 4. Deploy

```powershell
git add -A
git commit -m "Phase ESE-1 — Standard Envelope audit: shipping-profile capture + triage endpoint"
git pull --rebase
git push
```

## 5. Let the sweep refill the mirror

The shipping columns are empty until the **full listing sweep** runs (the
daily GitHub Action, or trigger the sync cron by hand the way you do after a
category change). A ~7,000-item store takes a few cron invocations.

Check coverage any time while signed in to the admin:

```
https://foundinalabama.com/api/admin/ebay/ese-audit
```

`coverage.withProfile` climbs toward `coverage.listings`. Until it is
non-zero the audit says so in `coverage.note`.

## 6. Pull the audit

- Summary JSON (counts, top offending categories, profile names):
  `/api/admin/ebay/ese-audit`
- CSV of everything to fix:
  `/api/admin/ebay/ese-audit?format=csv`
- One pile at a time:
  `/api/admin/ebay/ese-audit?format=csv&action=reship`
  `/api/admin/ebay/ese-audit?format=csv&action=recategorize`

Send Cowork the summary JSON (or the CSV) — the `byProfile` block will also
tell us the EXACT policy names eBay uses for your envelope and 4oz
profiles, which the next phases need verbatim.

## 7. Sanity-check five rows by hand

Open five `reship` rows and five `recategorize` rows in Nifty. Confirm the
eBay Shipping policy really reads envelope and the category really is what
the CSV says. If the extension's own guard would have moved one of them,
that is expected — these are listings that predate v1.34.

## What's next (not in this phase)

- **ESE-2: Nifty-side fix (the part that survives "Recreate").** Nifty's
  MCP cannot touch shipping (docs: title/description/condition/quantity/
  cost/SKU/prices only) and Nifty's Bulk Edit can't either, so this is a
  new `reshipItem` / `recatEbayCategory` actuator in the TES Actuator
  extension, fed by an `ese_fix_queue` table exactly like `tes_recat_queue`:
  row → item drawer → eBay section → Shipping policy combo → the 4oz policy
  (or the Category picker → eligible category) → Save. The combo-selection
  code already exists in the pricer extension (v1.31 shipping-policy swap).
- **ESE-3: eBay-side fix (immediate).** An Enhance op `shipping_profile_fix`
  doing `ReviseItem` with `SellerProfiles.SellerShippingProfile.ShippingProfileID`
  = the 4oz policy, dryRun default TRUE, before/after + rollback for free.
  Runs AFTER ESE-2 on the same rows, so Nifty's next push and eBay agree.
- **Prevention:** the pricer extension's guard currently forces an eligible
  category on every envelope draft; for non-card groups it should switch to
  the 4oz policy instead. One-line rule change in `applyEseCategoryGuard`.
