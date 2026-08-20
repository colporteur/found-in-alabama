// Featured-category slots for The Ephemeral State home page.
//
// Config lives in app_settings under "tesFeaturedSlots" as an array of
// raw slots, each one of:
//   "states"                          — the Explore-by-State slot
//   "cat:<categoryId>"                — a real store category (parents get
//                                       a dropdown of their children)
//   { name, categoryIds: [...] }      — a CUSTOM GROUP: a virtual parent
//                                       that doesn't exist on eBay (e.g.
//                                       "Collectible Niches" holding
//                                       Militaria, Railroads, Scouting…)
// Todd edits them at /admin/tes-featured. Resolution against the live
// TES category tree happens at render time, so empty categories drop
// out automatically.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

export const FEATURED_KEY = "tesFeaturedSlots";
export const MAX_SLOTS = 6;

export type RawSlot = string | { name: string; categoryIds: string[] };

export type FeaturedSlot =
  | { type: "states" }
  | { type: "category"; categoryId: string }
  | { type: "group"; name: string; categoryIds: string[] };

export function parseSlot(raw: RawSlot): FeaturedSlot | null {
  if (typeof raw === "string") {
    if (raw === "states") return { type: "states" };
    if (raw.startsWith("cat:") && raw.length > 4)
      return { type: "category", categoryId: raw.slice(4) };
    return null;
  }
  if (
    raw &&
    typeof raw === "object" &&
    typeof raw.name === "string" &&
    raw.name.trim() !== "" &&
    Array.isArray(raw.categoryIds)
  ) {
    const ids = raw.categoryIds
      .filter((id): id is string => typeof id === "string" && id !== "")
      .slice(0, 50);
    if (ids.length > 0)
      return { type: "group", name: raw.name.trim().slice(0, 40), categoryIds: ids };
  }
  return null;
}

export async function getFeaturedRawSlots(): Promise<RawSlot[]> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(sql`${appSettings.key} = ${FEATURED_KEY}`)
    .limit(1);
  if (!row || !Array.isArray(row.value)) return [];
  return (row.value as RawSlot[]).filter((v) => parseSlot(v) !== null).slice(0, MAX_SLOTS);
}

export async function setFeaturedRawSlots(slots: RawSlot[]): Promise<void> {
  // Normalize through parse/serialize so only valid, trimmed data persists.
  const clean: RawSlot[] = [];
  for (const raw of Array.isArray(slots) ? slots : []) {
    const slot = parseSlot(raw);
    if (!slot) continue;
    if (slot.type === "states") clean.push("states");
    else if (slot.type === "category") clean.push(`cat:${slot.categoryId}`);
    else clean.push({ name: slot.name, categoryIds: slot.categoryIds });
    if (clean.length >= MAX_SLOTS) break;
  }
  await db
    .insert(appSettings)
    .values({ key: FEATURED_KEY, value: clean, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: clean, updatedAt: new Date() },
    });
}
