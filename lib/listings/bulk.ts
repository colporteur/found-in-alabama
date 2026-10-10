// Bulk store-shelf change for listing drafts. Each draft has up to two eBay
// store shelves: usually one for what the item IS and one place shelf
// ("Found in Other States › Indiana", or an Alabama shelf). "Keep the place
// shelf" puts the new shelf in the other slot; otherwise the new shelf
// replaces the first one. Only editable drafts change.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { buildCategoryOptions } from "@/lib/ebay/auto-categorize";
import { EDITABLE_STATUS_LIST } from "./drafts";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export type ShelfInfo = { id: string; path: string; isPlace: boolean };

export const isPlacePath = (path: string, isAlabama: boolean) => isAlabama || /^found in other states\b/i.test(path.trim());

/** Pure: the two shelves after the change. */
export function nextShelves(current: string[], shelf: string, keepPlace: boolean, info: Map<string, ShelfInfo>): string[] {
  const cur = current.filter(Boolean).slice(0, 2);
  if (cur.includes(shelf)) return cur;
  if (keepPlace) {
    const place = cur.find((id) => info.get(id)?.isPlace && id !== shelf);
    if (place) return [shelf, place];
  }
  // Replace the first shelf; keep the second if there is one.
  const second = cur[1] && cur[1] !== shelf ? cur[1] : null;
  return second ? [shelf, second] : [shelf];
}

export async function shelfInfo(): Promise<Map<string, ShelfInfo>> {
  const opts = await buildCategoryOptions();
  return new Map(
    opts.map((o) => {
      const path = o.path.replace(/&amp;/g, "&");
      return [o.id, { id: o.id, path, isPlace: isPlacePath(path, o.isAlabama) }];
    })
  );
}

export async function setStoreShelf(
  ids: string[],
  shelf: string,
  keepPlace: boolean
): Promise<{ changed: number; already: number; skipped: number; shelf: string }> {
  const info = await shelfInfo();
  const target = info.get(shelf);
  if (!target) throw new Error("Pick one of the store's shelves");
  const clean = Array.from(new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))).slice(0, 500);
  if (!clean.length) return { changed: 0, already: 0, skipped: 0, shelf: target.path };
  const found = await rows(sql`
    SELECT id, status, store_category_ids FROM listing_drafts
    WHERE id IN (${sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `)})`);
  let changed = 0;
  let already = 0;
  let skipped = clean.length - found.length;
  for (const d of found) {
    if (!(EDITABLE_STATUS_LIST as readonly string[]).includes(String(d.status))) {
      skipped++;
      continue;
    }
    const cur = Array.isArray(d.store_category_ids) ? (d.store_category_ids as unknown[]).map(String) : [];
    const next = nextShelves(cur, shelf, keepPlace, info);
    if (JSON.stringify(next) === JSON.stringify(cur.filter(Boolean).slice(0, 2))) {
      already++;
      continue;
    }
    await db.execute(sql`
      UPDATE listing_drafts SET store_category_ids = ${JSON.stringify(next)}::jsonb,
        written_by = CASE WHEN written_by IS NULL OR written_by = 'hand' THEN 'hand'
                          WHEN written_by LIKE 'claude%' THEN 'claude+hand' ELSE 'ai+hand' END,
        updated_at = now()
      WHERE id = ${String(d.id)}::uuid`);
    changed++;
  }
  return { changed, already, skipped, shelf: target.path };
}
