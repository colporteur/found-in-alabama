// SKU schema classifier for the workbench (Phase W1).
//
// Todd's SKU nomenclature, accumulated over time:
//   bin         NA### (exactly 3 digits) — storage bins, ascending as bins fill
//   vinyl       "RPM YYMMDD" — 33 260702 = a 33rpm record listed 2026-07-02
//   media       YYMMDD — books and CDs, the listing date
//   named_bin   "Smalls 1", "Patches 1", "Buttons 2" — special-item bins
//   card_legacy 367-m7qgb — old sporting-card software's ascending id + suffix
//   card        plain ascending number — later sporting cards
//   oversize    literally "Apps"
//   none        empty / missing SKU
//   irregular   matches nothing above — the cleanup worklist
//
// Classification happens in SQL (Postgres ~ regex) so filters apply
// across the whole store, not just the visible page. Order matters:
// vinyl before named_bin (both are "word number"-ish), media before card
// (a 6-digit card number would read as a date — acceptable ambiguity).

import { sql, type SQL } from "drizzle-orm";
import { ebayListings } from "@/db/schema";

export const SKU_CLASSES = [
  "bin",
  "vinyl",
  "media",
  "named_bin",
  "card_legacy",
  "card",
  "oversize",
  "none",
  "irregular",
] as const;
export type SkuClass = (typeof SKU_CLASSES)[number];

export const SKU_CLASS_LABELS: Record<SkuClass, string> = {
  bin: "Bin (NA###)",
  vinyl: "Vinyl (RPM YYMMDD)",
  media: "Media (YYMMDD)",
  named_bin: "Named bin",
  card_legacy: "Card (legacy id)",
  card: "Card (number)",
  oversize: "Oversize (Apps)",
  none: "No SKU",
  irregular: "Irregular ⚠",
};

/** The classifying CASE expression, reusable in SELECT, WHERE, ORDER BY. */
export function skuClassSql(): SQL<SkuClass> {
  const sku = ebayListings.sku;
  return sql<SkuClass>`CASE
    WHEN ${sku} IS NULL OR ${sku} = '' THEN 'none'
    WHEN ${sku} = 'Apps' THEN 'oversize'
    WHEN ${sku} ~ '^NA[0-9]{3}$' THEN 'bin'
    WHEN ${sku} ~ '^(16|33|45|78) [0-9]{6}$' THEN 'vinyl'
    WHEN ${sku} ~ '^[0-9]{6}$' THEN 'media'
    WHEN ${sku} ~ '^[A-Za-z]+ [0-9]+$' THEN 'named_bin'
    WHEN ${sku} ~ '^[0-9]+-[A-Za-z0-9]+$' THEN 'card_legacy'
    WHEN ${sku} ~ '^[0-9]+$' THEN 'card'
    ELSE 'irregular'
  END`;
}

/**
 * Natural sort key for SKUs: class first, then the numeric content
 * (NA47 < NA313; vinyl sorts by RPM then date since "33 260702" → 33260702).
 * Non-numeric SKUs fall back to text ordering via the third key.
 */
export function skuNaturalOrderSql(): SQL[] {
  return [
    skuClassSql(),
    sql`NULLIF(regexp_replace(coalesce(${ebayListings.sku}, ''), '[^0-9]', '', 'g'), '')::bigint`,
    sql`${ebayListings.sku}`,
  ];
}
