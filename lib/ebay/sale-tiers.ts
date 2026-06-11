// Automated stale-inventory sales — tier config + inventory analysis.
//
// Todd's model: inventory ages in quarters. Nothing goes on sale before
// 6 months; after that, discounts deepen progressively per quarter
// ("staggered"). Tiers are configurable on /admin/ebay/sales and stored
// in the app_settings table under the key "ebaySaleTiers".
//
// Inventory source: the ebay_listings table — a local mirror of ALL
// active eBay listings (synced via /api/admin/ebay/pull-listings with
// full: true; "Sync all listings" button on the sales page). Age comes
// from the listing's own StartTime on eBay. The items table (Nifty
// captures) only covers a fraction of the store, so it's not used here.
//
// The weekly cron (app/api/cron/ebay-sales) reads the tiers, selects
// each tier's eBay listings by age, and maintains one live markdown
// promotion per tier.

import { and, eq, gt, isNotNull } from "drizzle-orm";
import { db, ebayListings, appSettings } from "@/db";

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

function ageDays(startTime: Date, now: Date): number {
  return Math.floor((now.getTime() - startTime.getTime()) / 86_400_000);
}

type ActiveListingRow = {
  itemId: string;
  startTime: Date | null;
  quantity: number | null;
};

/**
 * All in-stock listings with a known start date. Zero-quantity listings
 * are excluded — eBay keeps sold-out listings "active" for a while, but
 * they can't go on sale.
 */
async function loadActiveListings(): Promise<ActiveListingRow[]> {
  return db
    .select({
      itemId: ebayListings.itemId,
      startTime: ebayListings.startTime,
      quantity: ebayListings.quantity,
    })
    .from(ebayListings)
    .where(and(gt(ebayListings.quantity, 0), isNotNull(ebayListings.startTime)));
}

/** Total listings in the mirror (for the "synced N listings" hint). */
export async function countSyncedListings(): Promise<number> {
  const rows = await db
    .select({ itemId: ebayListings.itemId })
    .from(ebayListings);
  return rows.length;
}

export type AgeBucket = {
  /** e.g. "0–3 mo" */
  label: string;
  minDays: number;
  /** exclusive; null = open-ended */
  maxDays: number | null;
  itemCount: number;
};

/** Quarterly age distribution of active inventory, for the config chart. */
export async function getAgeDistribution(
  now: Date = new Date()
): Promise<AgeBucket[]> {
  const rows = await loadActiveListings();
  const buckets: AgeBucket[] = [
    { label: "0–3 mo", minDays: 0, maxDays: 90, itemCount: 0 },
    { label: "3–6 mo", minDays: 90, maxDays: 180, itemCount: 0 },
    { label: "6–9 mo", minDays: 180, maxDays: 270, itemCount: 0 },
    { label: "9–12 mo", minDays: 270, maxDays: 360, itemCount: 0 },
    { label: "12–15 mo", minDays: 360, maxDays: 450, itemCount: 0 },
    { label: "15+ mo", minDays: 450, maxDays: null, itemCount: 0 },
  ];
  for (const row of rows) {
    if (!row.startTime) continue;
    const age = ageDays(row.startTime, now);
    const bucket = buckets.find(
      (b) => age >= b.minDays && (b.maxDays === null || age < b.maxDays)
    );
    if (bucket) bucket.itemCount++;
  }
  return buckets;
}

/**
 * eBay listing ids for one tier: listings whose age is ≥ tier.minAgeDays
 * and < the next tier's minAgeDays (tiers don't overlap — a listing
 * belongs to exactly one tier so it never sits in two sales).
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
    if (!row.startTime) continue;
    const age = ageDays(row.startTime, now);
    if (age < tier.minAgeDays) continue;
    if (maxAge !== null && age >= maxAge) continue;
    ids.push(row.itemId);
  }
  // eBay caps INVENTORY_BY_VALUE at 500 listings per promotion.
  return [...new Set(ids)].slice(0, 500);
}
