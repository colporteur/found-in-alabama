-- One-time cleanup (Oct 9, 2026): the eBay events hook counted OLD sales as
-- new ones. Sold-out GTC listings stay on eBay at quantity 0 and renew every
-- 30 days; each renewal showed up as a "sale". Those are marked ignored here
-- (the fix in lib/ebay/events-sync.ts stops new ones). An old sale is one
-- whose registry item was already sold more than a day before it was
-- "detected". Nothing is deleted. The to-ship queue drops them on its next
-- sync (packages not yet packed become cancelled).
UPDATE "sale_events" e
SET "status" = 'ignored',
    "resolved_by" = 'fix-0036',
    "note" = trim(both ' ' from coalesce(e."note", '') || ' · old eBay sale re-surfaced on a listing renewal'),
    "updated_at" = now()
FROM "registry_items" r
WHERE r."id" = e."registry_item_id"
  AND e."source" = 'ebay_events'
  AND e."status" = 'matched'
  AND r."sold_at" < e."detected_at" - interval '1 day';
