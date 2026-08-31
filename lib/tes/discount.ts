// Store-wide flat discount for The Ephemeral State ("always X% below
// eBay"). The mirror carries eBay prices; TES applies this percentage
// everywhere a price is shown or charged — storefront cards, product
// pages, cart resolution, and the Google Merchant feed (as sale_price).
//
// Interaction with eBay markdown sales: the flat discount NEVER stacks
// with a sale badge — whichever percentage is larger wins. Funded by the
// eBay→Stripe fee spread (~10-13 points), so a 10% discount still nets
// more per sale than eBay does.
//
// Config lives in app_settings under "tesGlobalDiscountPercent"; Todd
// edits it at /admin/tes-featured. 0 turns the program off.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

export const TES_DISCOUNT_KEY = "tesGlobalDiscountPercent";
export const MAX_TES_DISCOUNT = 50;

/** Clamp to a sane integer percentage (0–50). */
export function normalizeTesDiscount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_TES_DISCOUNT, Math.max(0, Math.round(n)));
}

export async function getTesDiscountPercent(): Promise<number> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(sql`${appSettings.key} = ${TES_DISCOUNT_KEY}`)
    .limit(1);
  return normalizeTesDiscount(row?.value);
}

export async function setTesDiscountPercent(pct: number): Promise<void> {
  const clean = normalizeTesDiscount(pct);
  await db
    .insert(appSettings)
    .values({ key: TES_DISCOUNT_KEY, value: clean, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: clean, updatedAt: new Date() },
    });
}

/** Winning percentage: flat store-wide vs. a sale badge — never stacked. */
export function bestDiscountPercent(
  globalPct: number,
  badgePct: number | null | undefined
): number {
  return Math.max(normalizeTesDiscount(globalPct), badgePct ?? 0);
}

/** Price after a percentage discount, rounded to cents. */
export function discountedPrice(price: number, pct: number): number {
  if (pct <= 0) return price;
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}
