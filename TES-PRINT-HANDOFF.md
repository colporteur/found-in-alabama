# TES print-order feed — September 24, 2026

Purpose: support automatic inclusion of paid theephemeralstate.com orders in Nifty Pick List v1.4.0, separately for pick lists and invoices. Todd requested only orders paid from September 24 onward.

Changed files:
- `app/api/tes/print-orders/route.ts`: new authenticated GET feed.
- `scripts/tes-print-orders.test.cjs`: authentication, validation, paid TES selection, date boundary and pagination tests.
- This handoff.

Interface: `GET /api/tes/print-orders?since=<ISO timestamp>&after=<UUID>` on `https://www.foundinalabama.com`, authenticated with the existing `Authorization: Bearer <website API key>` system. Returns `{ok, orders, nextCursor}`. Orders include ID, buyer name, paid date, subtotal/shipping/total and complete stored line items. Pages contain up to 100 orders, sorted by UUID. The extension rescans from the selected starting paid date each run and removes previously included IDs locally. UUID pagination is a per-fetch cursor, not a persistent newest-order watermark. Orders becoming paid while scanning may appear on the next run.

Only source `tes` and status `paid` are returned. Delist status is deliberately independent. No email or shipping address is returned. Responses are private/no-store. No new environment variables, services or database migration. Existing order/payment/fulfillment behavior is untouched.

Deployment: existing repository handoff assigns production deployment to Todd. Deploy these specific files through the normal Git/Vercel process; avoid staging unrelated work currently present in the checkout. This change has not been committed, pushed or deployed. Extension activation instructions are in `C:\Users\noren\code\extensions\nifty-pick-list\TES-PRINT-HANDOFF.md`.

Validation: `node --test --test-isolation=none scripts/tes-print-orders.test.cjs` passed (2 tests); `node node_modules/typescript/bin/tsc --noEmit --incremental false` passed. Extension checks passed (6 tests, including TES-only invoice branding). Tests use mocked database/network/storage; no production database query or authenticated end-to-end print was performed.

Rollback: disable website orders in Nifty Pick List before removing the endpoint in a later deployment. No database rollback is required. Keep extension storage to preserve both inclusion histories.
