# Phase SHIP-1: TES orders → Pirate Ship (September 25, 2026)

Pirate Ship has no public API and no connector for a custom Stripe
checkout. It does accept spreadsheet uploads and remembers your column
mapping after the first one. So the integration runs as spreadsheets in
both directions, driven from `/admin/tes-orders`:

1. **Download new orders.** The "Ship with Pirate Ship" panel downloads
   paid, unshipped theephemeralstate.com orders as `tes-pirate-ship-YYYY-MM-DD.csv`
   and marks them "Sent to Pirate Ship".
2. **Pirate Ship → Ship → Upload a spreadsheet.** Pick the file, check
   weights, buy labels.
3. **Pirate Ship → Reports / Ship history → Export.** Choose the date
   range → CSV.
4. **Import tracking CSV** on `/admin/tes-orders`. Each TES order gets its
   tracking number and a "Shipped" badge with a tracking link. eBay labels
   and other non-TES rows in the same export are skipped and listed as
   "not TES orders". Voided labels are ignored.

HipPostcard orders are not included, because Hip keeps their addresses.

**Test orders / orders you won't ship:** click **don't ship** on the order
card. The order shows "Not shipping", is left out of every Pirate Ship
download and the counts, and can be restored with **undo**. (It sets
`shipped_at` with no tracking and `carrier = "not shipping"`, so no
migration is needed.)

## The CSV (Pirate Ship remembers these header names — don't rename them)

| Column | Contents | Map to in Pirate Ship |
|---|---|---|
| Order ID | full TES order UUID (the match key for tracking import) | Order ID |
| Name, Address Line 1/2, City, State, Zipcode, Country | Stripe shipping address | same names |
| Email | buyer email | Email. Pirate Ship then emails the buyer tracking |
| Weight (oz) | estimate by ship class (below) | Weight: ounces |
| Length / Width / Height (in) | box for the heaviest class on the order | Length / Width / Height |
| Rubber Stamp 1 | `Bins: 12×2, 31` (SKU bin numbers) | Rubber Stamp 1 |
| Rubber Stamp 2 | `TES #3f2c9a10` | Rubber Stamp 2 |
| Rubber Stamp 3 | `3 items · media` | Rubber Stamp 3 |

**Package estimates** live in `PACKAGE_PRESETS` in `lib/tes/pirate-ship.ts`
(heaviest class sets the box and base weight; each extra unit adds its
class increment):

| Class | Box | First item | Each additional |
|---|---|---|---|
| paper | 9×6×0.5 rigid mailer | 3 oz | +0.5 oz |
| media | 10×8×2 book box | 16 oz | +8 oz |
| bulky | 12×10×4 small box | 32 oz | +16 oz |

These are starting guesses. Pirate Ship shows every weight before you buy.
Once you've weighed a few real parcels, adjust the numbers.

If the tracking import says it can't find an Order ID column, it falls back
to matching recipient name + ZIP against open orders. It matches only when
there's exactly one candidate. For anything it can't match, use **add
tracking** on the order card. The same editor also clears a wrong match.

## What changed

- `db/schema.ts`: `tes_orders` gets `pirate_exported_at`, `tracking_number`,
  `carrier`, `shipped_at` and an index on `shipped_at`.
- `drizzle/0026_pirate_ship.sql` (+ meta snapshot/journal): only additive
  `ALTER TABLE … ADD COLUMN`.
- `lib/tes/pirate-ship.ts`: pure module (CSV build, CSV parse, tracking
  extraction, package presets).
- `app/api/admin/tes-orders/pirate-ship/route.ts`: GET CSV download
  (`?scope=new|unshipped`, `&mark=0` to preview without stamping).
- `app/api/admin/tes-orders/tracking-import/route.ts`: POST `{csv}`.
- `app/api/admin/tes-orders/[id]/tracking/route.ts`: POST manual set/clear.
- `app/(fia)/admin/tes-orders/`: `page.tsx` (panel + per-order status),
  `PirateShipPanel.tsx`, `TrackingEditor.tsx`.
- `scripts/tes-pirate-ship.test.cjs`: 6 tests.

All new routes require the admin session. Nothing changes in checkout, the
Stripe webhook, the delist queue, the print-orders feed or Hip.

## Deploy

```powershell
cd C:\Users\noren\code\found-in-alabama
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
npm run db:migrate
node --test scripts/tes-pirate-ship.test.cjs
git add db/schema.ts drizzle/0026_pirate_ship.sql drizzle/meta lib/tes/pirate-ship.ts app/api/admin/tes-orders "app/(fia)/admin/tes-orders" scripts/tes-pirate-ship.test.cjs PHASE-SHIP-1-SETUP.md
git commit -m "Phase SHIP-1: Pirate Ship CSV export + tracking import for TES orders"
git pull --rebase
git push
```

Run the migration **before** the deploy goes live. The orders page reads
the new columns.

Stage only the paths above. The checkout has other uncommitted work
(hip-readiness etc.).

## First run

The first upload in Pirate Ship asks you to map the columns. Use the table
above, and remember to set Weight to **ounces**. After that, uploads are
one click.

## Rollback

Revert the commit. The four columns are nullable and unused elsewhere, so
they can stay in the database.
