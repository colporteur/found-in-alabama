// Automated stale-inventory sales — tier config + inventory analysis.
//
// Two complementary systems (see lib/ebay/sku-age.ts for why):
//
//  1. AGE TIERS (quarterly): an item's true age comes from its SKU date
//     when one parses (media SKUs — survives Nifty's end-and-sell-similar
//     recreates), else from the listing's eBay StartTime. Nothing goes
//     on sale before 6 months; discounts deepen per quarter.
//
//  2. BIN TIERS: non-media inventory lives in sequential bins (NA59 …
//     NA317); lower bin = older. Configurable bin ranges with their own
//     discounts catch what StartTime hides and SKU dates can't see.
//
// Age tiers take priority: the cron excludes any listing claimed by an
// enabled age tier from bin selection, so an item is never in two sales.
//
// Inventory source: the ebay_listings table — a local mirror of ALL
// active eBay listings (synced via "Sync all listings" on the sales
// page). Configs live in app_settings ("ebaySaleTiers" / "ebayBinSaleTiers").

import { and, eq, gt } from "drizzle-orm";
import { db, ebayListings, appSettings } from "@/db";
import { parseBinNumber, parseSkuDate } from "@/lib/ebay/sku-age";

// ─── Age tiers ───────────────────────────────────────────────────────────────

export type SaleTier = {
  /** Stable key, e.g. "q2" — used to link eBay promotions back to tiers. */
  key: string;
  /** Items at least this old (days) fall into this tier... */
  minAgeDays: number;
  /** ...until they reach the next tier's minAgeDays (null = open-ended). */
  discountPercent: number;
  enabled: boolean;
};

export const TIERS_SETTINGS_KEY = "ebaySaleTiers";

/** Default ladder: quarters, starting at 6 months, deepening by 5%. */
export const DEFAULT_TIERS: SaleTier[] = [
  { key: "q2", minAgeDays: 180, discountPercent: 10, enabled: false },
  { key: "q3", minAgeDays: 270, discountPercent: 15, enabled: false },
  { key: "q4", minAgeDays: 360, discountPercent: 20, enabled: false },
  { key: "q5plus", minAgeDays: 450, discountPercent: 25, enabled: false },
];

function isValidTier(t: unknown): t is SaleTier {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.key === "string" &&
    typeof o.minAgeDays === "number" &&
    o.minAgeDays >= 0 &&
    typeof o.discountPercent === "number" &&
    o.discountPercent > 0 &&
    o.discountPercent <= 80 &&
    typeof o.enabled === "boolean"
  );
}

export async function getTiers(): Promise<SaleTier[]> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, TIERS_SETTINGS_KEY))
    .limit(1);
  if (!row || !Array.isArray(row.value)) return DEFAULT_TIERS;
  const tiers = (row.value as unknown[]).filter(isValidTier);
  if (tiers.length === 0) return DEFAULT_TIERS;
  return tiers.sort((a, b) => a.minAgeDays - b.minAgeDays);
}

export async function saveTiers(tiers: SaleTier[]): Promise<SaleTier[]> {
  const valid = tiers.filter(isValidTier);
  if (valid.length === 0) {
    throw new Error("No valid tiers to save.");
  }
  const sorted = [...valid].sort((a, b) => a.minAgeDays - b.minAgeDays);
  await db
    .insert(appSettings)
    .values({ key: TIERS_SETTINGS_KEY, value: sorted, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sorted, updatedAt: new Date() },
    });
  return sorted;
}

// ─── Bin tiers ───────────────────────────────────────────────────────────────

export type BinTier = {
  key: string;
  /** Inclusive bin range; maxBin null = open-ended upward. */
  minBin: number;
  maxBin: number | null;
  discountPercent: number;
  enabled: boolean;
};

export const BIN_TIERS_SETTINGS_KEY = "ebayBinSaleTiers";

export const DEFAULT_BIN_TIERS: BinTier[] = [
  { key: "bins-oldest", minBin: 0, maxBin: 150, discountPercent: 20, enabled: false },
  { key: "bins-mid", minBin: 151, maxBin: 220, discountPercent: 10, enabled: false },
];

function isValidBinTier(t: unknown): t is BinTier {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.key === "string" &&
    typeof o.minBin === "number" &&
    o.minBin >= 0 &&
    (o.maxBin === null ||
      (typeof o.maxBin === "number" && o.maxBin >= (o.minBin as number))) &&
    typeof o.discountPercent === "number" &&
    o.discountPercent > 0 &&
    o.discountPercent <= 80 &&
    typeof o.enabled === "boolean"
  );
}

export async function getBinTiers(): Promise<BinTier[]> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, BIN_TIERS_SETTINGS_KEY))
    .limit(1);
  if (!row || !Array.isArray(row.value)) return DEFAULT_BIN_TIERS;
  const tiers = (row.value as unknown[]).filter(isValidBinTier);
  if (tiers.length === 0) return DEFAULT_BIN_TIERS;
  return tiers.sort((a, b) => a.minBin - b.minBin);
}

export async function saveBinTiers(tiers: BinTier[]): Promise<BinTier[]> {
  const valid = tiers.filter(isValidBinTier);
  if (valid.length === 0) {
    throw new Error("No valid bin tiers to save.");
  }
  const sorted = [...valid].sort((a, b) => a.minBin - b.minBin);
  await db
    .insert(appSettings)
    .values({
      key: BIN_TIERS_SETTINGS_KEY,
      value: sorted,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sorted, updatedAt: new Date() },
    });
  return sorted;
}

// ─── Inventory loading ───────────────────────────────────────────────────────

type ActiveListingRow = {
  itemId: string;
  sku: string | null;
  startTime: Date | null;
  quantity: number | null;
};

/** All in-stock listings (zero-quantity = sold out, can't go on sale). */
async function loadActiveListings(): Promise<ActiveListingRow[]> {
  return db
    .select({
      itemId: ebayListings.itemId,
      sku: ebayListings.sku,
      startTime: ebayListings.startTime,
      quantity: ebayListings.quantity,
    })
    .from(ebayListings)
    .where(and(gt(ebayListings.quantity, 0)));
}

/** Total listings in the mirror (for the "synced N listings" hint). */
export async function countSyncedListings(): Promise<number> {
  const rows = await db
    .select({ itemId: ebayListings.itemId })
    .from(ebayListings);
  return rows.length;
}

/**
 * True age in days: SKU date when one parses (survives listing
 * recreation), else eBay StartTime, else null (unageable).
 */
function effectiveAgeDays(row: ActiveListingRow, now: Date): number | null {
  const skuDate = parseSkuDate(row.sku, now);
  const ref = skuDate ?? row.startTime;
  if (!ref) return null;
  return Math.floor((now.getTime() - ref.getTime()) / 86_400_000);
}

// ─── Distributions (for the config charts) ───────────────────────────────────

export type AgeBucket = {
  /** e.g. "0–3 mo" */
  label: string;
  minDays: number;
  /** exclusive; null = open-ended */
  maxDays: number | null;
  itemCount: number;
  /** how many ages came from a SKU date (vs listing StartTime) */
  fromSku: number;
};

/** Quarterly age distribution of active inventory. */
export async function getAgeDistribution(
  now: Date = new Date()
): Promise<AgeBucket[]> {
  const rows = await loadActiveListings();
  const buckets: AgeBucket[] = [
    { label: "0–3 mo", minDays: 0, maxDays: 90, itemCount: 0, fromSku: 0 },
    { label: "3–6 mo", minDays: 90, maxDays: 180, itemCount: 0, fromSku: 0 },
    { label: "6–9 mo", minDays: 180, maxDays: 270, itemCount: 0, fromSku: 0 },
    { label: "9–12 mo", minDays: 270, maxDays: 360, itemCount: 0, fromSku: 0 },
    { label: "12–15 mo", minDays: 360, maxDays: 450, itemCount: 0, fromSku: 0 },
    { label: "15+ mo", minDays: 450, maxDays: null, itemCount: 0, fromSku: 0 },
  ];
  for (const row of rows) {
    const age = effectiveAgeDays(row, now);
    if (age === null || age < 0) continue;
    const bucket = buckets.find(
      (b) => age >= b.minDays && (b.maxDays === null || age < b.maxDays)
    );
    if (!bucket) continue;
    bucket.itemCount++;
    if (parseSkuDate(row.sku, now)) bucket.fromSku++;
  }
  return buckets;
}

export type BinBucket = {
  /** e.g. "NA75–NA99" */
  label: string;
  minBin: number;
  maxBin: number;
  itemCount: number;
};

/** Distribution of bin-SKU inventory in buckets of 25 bins. */
export async function getBinDistribution(): Promise<BinBucket[]> {
  const rows = await loadActiveListings();
  const binCounts = new Map<number, number>();
  for (const row of rows) {
    const bin = parseBinNumber(row.sku);
    if (bin === null) continue;
    binCounts.set(bin, (binCounts.get(bin) ?? 0) + 1);
  }
  if (binCounts.size === 0) return [];

  const bins = [...binCounts.keys()];
  const lo = Math.floor(Math.min(...bins) / 25) * 25;
  const hi = Math.max(...bins);
  const buckets: BinBucket[] = [];
  for (let start = lo; start <= hi; start += 25) {
    const end = start + 24;
    let count = 0;
    for (const [bin, c] of binCounts) {
      if (bin >= start && bin <= end) count += c;
    }
    buckets.push({
      label: `NA${start}–NA${end}`,
      minBin: start,
      maxBin: end,
      itemCount: count,
    });
  }
  return buckets;
}

// ─── Tier membership (for the cron) ──────────────────────────────────────────

/**
 * eBay listing ids for one age tier: age ≥ tier.minAgeDays and < the
 * next tier's minAgeDays. Tiers don't overlap. UNCAPPED — the cron
 * splits big tiers across multiple 500-listing promotions.
 */
export async function listingIdsForTier(
  tier: SaleTier,
  allTiers: SaleTier[],
  now: Date = new Date()
): Promise<string[]> {
  const sorted = [...allTiers].sort((a, b) => a.minAgeDays - b.minAgeDays);
  const next = sorted.find((t) => t.minAgeDays > tier.minAgeDays);
  const maxAge = next ? next.minAgeDays : null;

  const rows = await loadActiveListings();
  const ids: string[] = [];
  for (const row of rows) {
    const age = effectiveAgeDays(row, now);
    if (age === null) continue;
    if (age < tier.minAgeDays) continue;
    if (maxAge !== null && age >= maxAge) continue;
    ids.push(row.itemId);
  }
  return [...new Set(ids)];
}

/**
 * eBay listing ids for one bin tier (inclusive range), excluding any
 * ids already claimed by age tiers — an item belongs to one sale only.
 */
export async function listingIdsForBinTier(
  tier: BinTier,
  exclude: ReadonlySet<string>
): Promise<string[]> {
  const rows = await loadActiveListings();
  const ids: string[] = [];
  for (const row of rows) {
    if (exclude.has(row.itemId)) continue;
    const bin = parseBinNumber(row.sku);
    if (bin === null) continue;
    if (bin < tier.minBin) continue;
    if (tier.maxBin !== null && bin > tier.maxBin) continue;
    ids.push(row.itemId);
  }
  return [...new Set(ids)];
}
