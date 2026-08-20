// Featured-category slots for The Ephemeral State home page.
//
// Config lives in app_settings under "tesFeaturedSlots" as an array of
// slot strings: "states" (the Explore-by-State slot) or "cat:<categoryId>".
// Todd edits them at /admin/tes-featured. Resolution against the live
// TES category tree happens at render time, so empty categories drop
// out automatically.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

export const FEATURED_KEY = "tesFeaturedSlots";
export const MAX_SLOTS = 6;

export type FeaturedSlot = { type: "states" } | { type: "category"; categoryId: string };

export function parseSlot(raw: string): FeaturedSlot | null {
  if (raw === "states") return { type: "states" };
  if (raw.startsWith("cat:") && raw.length > 4)
    return { type: "category", categoryId: raw.slice(4) };
  return null;
}

export function serializeSlot(slot: FeaturedSlot): string {
  return slot.type === "states" ? "states" : `cat:${slot.categoryId}`;
}

export async function getFeaturedSlotStrings(): Promise<string[]> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(sql`${appSettings.key} = ${FEATURED_KEY}`)
    .limit(1);
  if (!row || !Array.isArray(row.value)) return [];
  return (row.value as unknown[])
    .filter((v): v is string => typeof v === "string")
    .slice(0, MAX_SLOTS);
}

export async function setFeaturedSlotStrings(slots: string[]): Promise<void> {
  const clean = slots
    .filter((s) => typeof s === "string" && parseSlot(s) !== null)
    .slice(0, MAX_SLOTS);
  await db
    .insert(appSettings)
    .values({ key: FEATURED_KEY, value: clean, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: clean, updatedAt: new Date() },
    });
}
