// SKU schema classifier for the workbench.
//
// Todd's SKU nomenclature, accumulated over time:
//   bin         NA### (exactly 3 digits) — storage bins, ascending as bins fill
//   jewelry     J# — jewelry bins (J1, J12)
//   longtail    LT### or LT###.# — compact paper/ephemera/photo storage;
//               the .# suffix is a sub-SKU within the long-tail sleeve
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
// across the whole store. Order matters: vinyl before named_bin, media
// before card (a 6-digit card number reads as a date — acceptable).

import { sql, type SQL } from "drizzle-orm";
import { ebayListings } from "@/db/schema";

export const SKU_CLASSES = [
  "bin",
  "jewelry",
  "longtail",
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
  jewelry: "Jewelry (J#)",
  longtail: "Long Tail (LT#)",
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
    WHEN ${sku} ~ '^J[0-9]+$' THEN 'jewelry'
    WHEN ${sku} ~ '^LT[0-9]+(\\.[0-9]+)?$' THEN 'longtail'
    WHEN ${sku} ~ '^(16|33|45|78) [0-9]{6}$' THEN 'vinyl'
    WHEN ${sku} ~ '^[0-9]{6}$' THEN 'media'
    WHEN ${sku} ~ '^[A-Za-z]+ [0-9]+$' THEN 'named_bin'
    WHEN ${sku} ~ '^[0-9]+-[A-Za-z0-9]+$' THEN 'card_legacy'
    WHEN ${sku} ~ '^[0-9]+$' THEN 'card'
    ELSE 'irregular'
  END`;
}

/**
 * Class-aware numeric key — "the number the SKU is really about":
 *   bin NA313 → 313 · jewelry J12 → 12 · longtail LT229.17 → 229 (main
 *   number; sub-SKU ignored) · vinyl "33 260702" → 260702 (the date, so
 *   ranges work across RPMs) · media → the YYMMDD date · cards → the
 *   leading id (suffix letters ignored) · named bins → the trailing
 *   number · everything else → NULL.
 * Powers the SKU-number range filter and natural sorting.
 */
export function skuNumericSql(): SQL<number | null> {
  const sku = ebayListings.sku;
  return sql<number | null>`CASE
    WHEN ${sku} ~ '^NA[0-9]{3}$' THEN (substring(${sku} from '^NA([0-9]{3})$'))::bigint
    WHEN ${sku} ~ '^J[0-9]+$' THEN (substring(${sku} from '^J([0-9]+)$'))::bigint
    WHEN ${sku} ~ '^LT[0-9]+(\\.[0-9]+)?$' THEN (substring(${sku} from '^LT([0-9]+)'))::bigint
    WHEN ${sku} ~ '^(16|33|45|78) [0-9]{6}$' THEN (substring(${sku} from '([0-9]{6})$'))::bigint
    WHEN ${sku} ~ '^[0-9]{6}$' THEN (${sku})::bigint
    WHEN ${sku} ~ '^[A-Za-z]+ [0-9]+$' THEN (substring(${sku} from '([0-9]+)$'))::bigint
    WHEN ${sku} ~ '^[0-9]+-[A-Za-z0-9]+$' THEN (substring(${sku} from '^([0-9]+)'))::bigint
    WHEN ${sku} ~ '^[0-9]+$' THEN (${sku})::bigint
    ELSE NULL
  END`;
}

/**
 * Natural sort: class, then the class-aware number, then raw SKU as the
 * tiebreaker (so LT229 < LT229.17, and same-date vinyl groups by RPM).
 */
export function skuNaturalOrderSql(): SQL[] {
  return [skuClassSql(), skuNumericSql(), sql`${ebayListings.sku}`];
}
