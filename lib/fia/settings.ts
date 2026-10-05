// Found in Alabama direct-sale settings (Phase FIA-SHOP-1), stored in
// app_settings so Todd edits them at /admin/fia-shop without a deploy:
//
//   fiaGlobalDiscountPercent  "X% below eBay" for foundinalabama.com
//                             (separate from TES's tesGlobalDiscountPercent)
//   fiaShipSettings           rate tables, handling, free threshold,
//                             oversize caps, fallback weights
//                             (see lib/fia/shipping.ts)

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { normalizeTesDiscount } from "@/lib/tes/discount";
import {
  normalizeFiaShipSettings,
  type FiaShipSettings,
} from "@/lib/fia/shipping";

export const FIA_DISCOUNT_KEY = "fiaGlobalDiscountPercent";
export const FIA_SHIP_SETTINGS_KEY = "fiaShipSettings";

async function readSetting(key: string): Promise<unknown> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(sql`${appSettings.key} = ${key}`)
    .limit(1);
  return row?.value;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

/** 0–50 integer percent; same clamp as the TES discount. */
export async function getFiaDiscountPercent(): Promise<number> {
  return normalizeTesDiscount(await readSetting(FIA_DISCOUNT_KEY));
}

export async function setFiaDiscountPercent(pct: number): Promise<void> {
  await writeSetting(FIA_DISCOUNT_KEY, normalizeTesDiscount(pct));
}

export async function getFiaShipSettings(): Promise<FiaShipSettings> {
  return normalizeFiaShipSettings(await readSetting(FIA_SHIP_SETTINGS_KEY));
}

export async function setFiaShipSettings(v: unknown): Promise<FiaShipSettings> {
  const clean = normalizeFiaShipSettings(v);
  await writeSetting(FIA_SHIP_SETTINGS_KEY, clean);
  return clean;
}
