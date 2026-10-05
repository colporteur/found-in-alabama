# HipPostcard readiness

The admin dashboard's **HipPostcard readiness** tool is at `/admin/hip-readiness`
on the Found in Alabama host. It shares the website's category selection and
reads positive-quantity inventory from the existing eBay mirror.

## Behavior

- Opening the page reads local inventory only. **Compare with Hip** makes
  read-only GET requests for active Hip listings. Nothing is published, closed,
  deleted, or written to the database. The existing Hip map/sales cron routes
  are deliberately not called because those perform mutations.
- A disconnected, failed, or incomplete scan never confirms an item is missing.
  Exact matches already observed may still appear as listed.
- Category suggestions use eBay item categories, not geographic store categories.
  Ambiguous merchandise stays in review. “Outside initial scope” is a pilot
  decision, not a statement about Hip's prohibited items.
- Matching uses eBay external identifiers and the reserved `tes-ebay:<itemId>`
  private identifier. Bin labels are not identity. Matching titles flag possible
  duplicates for review; they do not establish a link.
- Pilot review requires a complete Hip scan, one available unit, fixed price,
  a mirror refresh within 36 hours, usable cached text/images, and a category
  suggestion. This is still a preview: publication needs fresh availability,
  pricing/shipping decisions, and working sale/removal handling.
- Refresh inventory discards the previous Hip comparison. Reports carry their
  timestamps. CSV exports follow the current filter; JSON exports contain the
  full comparison including Hip listings outside the selected inventory.

## Connection

The existing server settings are `HIP_API_KEY` and `HIP_USERNAME` (Hip account
username, which can differ from the store slug). Set these only in private local
or hosting environment settings. Keys never go to the browser or report.
Restart the local server after changing environment settings.

For a local audit without enabling sale/delist integrations, use
`HIP_READINESS_API_KEY_FILE` (an absolute path to a private key text file) and
`HIP_READINESS_USERNAME`. Only the readiness page reads these settings; the key
stays in its original file. Hosting needs its own private connection settings
because a local Windows file is unavailable there.

The read-only command-line audit is `scripts/hip-readiness-audit.mts`. Supply
`--key-file`, `--username`, and `--output` to save a full comparison JSON report.
The script never closes or publishes listings and does not retain the key in
its output. A partial comparison exits with status 2 and remains labeled partial.

No database migration or scheduled job is required for this page. In particular,
do not activate `hip-sales` or `hip-map` to make this preview work.

## Reset versus adopting existing listings

Hip's API documents closing a listing with `DELETE /listings/{id}` and permanent
deletion with the additional `delete=1` option. No store-wide atomic purge was
confirmed. A batch job can enumerate and process individual IDs.

Before any later reset: export complete listing details (the readiness report
is not a restorable backup), review open/unpaid orders and auctions, stop native
eBay imports and any competing listing writer, and capture a fixed target-ID
list before closing anything. Enumerating changing active pages while closing
items can skip inventory. Prefer closing, verify the resulting active count,
and retain a per-item result log. Nothing in this feature performs that reset.

Adopting exact existing matches may avoid a reset altogether. The next phase
should add durable channel mapping independent of Hip's sync external ID,
resumable sales/removal work, per-item category overrides, and a 25–50-item
publication pilot before replacing native sync.

Sources checked 2026-09-17:
- https://hip-ecommerce.readme.io/reference/deletelisting
- https://hip-ecommerce.readme.io/reference/createlisting
- https://www.hippostcard.com/api-field-values/?filter=categories

Validation: `npx tsx --test lib/hip/readiness.test.mts`, `npx tsc --noEmit`,
targeted lint, and a local UI/API check. The tests cover duplicate prevention,
partial/malformed Hip responses, selection inheritance, data readiness, and CSV
formula escaping.
