// Bulk store-shelf change for listing drafts. Each draft has up to two eBay
// store shelves: usually one for what the item IS and one place shelf
// ("Found in Other States › Indiana", or an Alabama shelf). "Keep the place
// shelf" puts the new shelf in the other slot; otherwise the new shelf
// replaces the first one. Only editable drafts change.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { buildCategoryOptions } from "@/lib/ebay/auto-categorize";
import { suggestCategoryForListing, type CategoryOption } from "@/lib/ebay/categorize";
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
  // A new place shelf (a state, an Alabama shelf) takes the old place
  // shelf's slot, or the free slot — never the slot saying what the item is.
  if (keepPlace && info.get(shelf)?.isPlace) {
    const at = cur.findIndex((id) => info.get(id)?.isPlace);
    if (at >= 0) return cur.map((id, i) => (i === at ? shelf : id));
    return cur.length < 2 ? [...cur, shelf] : [cur[0], shelf];
  }
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

// ─── "Let FIA pick the subcategory" ─────────────────────────────────────────
// Todd picks a parent shelf (Postcards, Found in Other States, …); eBay can't
// hold items on a parent, so the AI picks the best subcategory under it for
// each draft from its title and description. Only that parent's subcategories
// are offered, and it must pick one.

export type ParentShelf = { id: string; path: string; leafIds: string[] };

const decode = (s: string) => s.replace(/&amp;/g, "&");

/** Pure: every shelf that has subcategories, with the assignable shelves under it (any depth). */
export function parentShelves(
  cats: Array<{ id: string; parentId: string | null; name: string; isOther: boolean }>,
  leafIds: Set<string>
): ParentShelf[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const kids = new Map<string, string[]>();
  for (const c of cats) if (c.parentId) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c.id]);
  const path = (id: string): string => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let cur: string | null = id; cur && !seen.has(cur); cur = byId.get(cur)?.parentId ?? null) {
      seen.add(cur);
      const n = byId.get(cur);
      if (n) names.unshift(decode(n.name));
    }
    return names.join(" › ");
  };
  const leavesUnder = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    return (kids.get(id) ?? []).flatMap((k) => (kids.has(k) ? leavesUnder(k, seen) : leafIds.has(k) ? [k] : []));
  };
  return cats
    .filter((c) => kids.has(c.id) && !c.isOther)
    .map((c) => ({ id: c.id, path: path(c.id), leafIds: leavesUnder(c.id) }))
    .filter((p) => p.leafIds.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadParentShelves(): Promise<ParentShelf[]> {
  const cats = await rows(sql`SELECT category_id, parent_category_id, name, is_other_bucket FROM ebay_store_categories`);
  const leaves = await buildCategoryOptions();
  return parentShelves(
    cats.map((c) => ({
      id: String(c.category_id),
      parentId: c.parent_category_id == null ? null : String(c.parent_category_id),
      name: String(c.name),
      isOther: c.is_other_bucket === true,
    })),
    new Set(leaves.map((l) => l.id))
  );
}

const plain = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export type AutoShelfResult = {
  changed: number;
  already: number;
  skipped: number;
  failed: number;
  parent: string;
  picks: Array<{ id: string; shelf: string | null; error?: string }>;
};

/**
 * Put each draft on the best subcategory of `parentId`. `slot` (0 or 1) sets
 * that slot exactly (the table's per-row pick); without it the bulk rule
 * applies (keep the place shelf, replace the other).
 */
export async function autoShelf(
  ids: string[],
  parentId: string,
  opts: { keepPlace: boolean; slot?: 0 | 1 }
): Promise<AutoShelfResult> {
  const parent = (await loadParentShelves()).find((p) => p.id === parentId);
  if (!parent) throw new Error("Pick a shelf that has subcategories");
  const leaves = await buildCategoryOptions();
  const under = new Set(parent.leafIds);
  const options: CategoryOption[] = leaves
    .filter((l) => under.has(l.id))
    .map((l) => ({ id: l.id, name: decode(l.name), path: decode(l.path), isAlabama: l.isAlabama }));
  const info = await shelfInfo();
  const clean = Array.from(new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))).slice(0, 25);
  const out: AutoShelfResult = { changed: 0, already: 0, skipped: 0, failed: 0, parent: parent.path, picks: [] };
  if (!clean.length) return out;
  const found = await rows(sql`
    SELECT id, status, title, title_hint, description, ebay_category_name, store_category_ids FROM listing_drafts
    WHERE id IN (${sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `)})`);
  out.skipped = clean.length - found.length;
  for (const d of found) {
    const id = String(d.id);
    if (!(EDITABLE_STATUS_LIST as readonly string[]).includes(String(d.status))) {
      out.skipped++;
      continue;
    }
    const title = String(d.title ?? d.title_hint ?? "").trim();
    if (!title) {
      out.failed++;
      out.picks.push({ id, shelf: null, error: "no title yet" });
      continue;
    }
    let pick: string | null = null;
    try {
      const s = await suggestCategoryForListing({
        title,
        details: [d.ebay_category_name ? `eBay category: ${d.ebay_category_name}` : "", plain(String(d.description ?? "")).slice(0, 700)]
          .filter(Boolean)
          .join("\n"),
        mustPickFrom: parent.path,
        categories: options,
      });
      pick = s.primaryCategoryId;
    } catch (err) {
      out.failed++;
      out.picks.push({ id, shelf: null, error: (err as Error).message.slice(0, 120) });
      continue;
    }
    if (!pick) {
      out.failed++;
      out.picks.push({ id, shelf: null, error: "no subcategory fit" });
      continue;
    }
    const cur = Array.isArray(d.store_category_ids) ? (d.store_category_ids as unknown[]).map(String).filter(Boolean).slice(0, 2) : [];
    let next: string[];
    if (opts.slot != null) {
      const two = [cur[0] ?? "", cur[1] ?? ""];
      two[opts.slot] = pick;
      if (two[1 - opts.slot] === pick) two[1 - opts.slot] = "";
      next = two.filter(Boolean);
    } else {
      next = nextShelves(cur, pick, opts.keepPlace, info);
    }
    out.picks.push({ id, shelf: info.get(pick)?.path ?? pick });
    if (JSON.stringify(next) === JSON.stringify(cur)) {
      out.already++;
      continue;
    }
    await db.execute(sql`
      UPDATE listing_drafts SET store_category_ids = ${JSON.stringify(next)}::jsonb,
        written_by = CASE WHEN written_by IS NULL OR written_by = 'hand' THEN 'hand'
                          WHEN written_by LIKE 'claude%' THEN 'claude+hand' ELSE 'ai+hand' END,
        updated_at = now()
      WHERE id = ${id}::uuid`);
    out.changed++;
  }
  return out;
}

// ─── bulk bin / SKU ──────────────────────────────────────────────────────────
// Todd often forgets the bin on the Scans page: set it on many drafts at
// once. Drafts not yet sent to Nifty can change (approved too — the bin goes
// to Nifty with the draft); pooled pieces keep LOTPOOL. "Only empty" (the
// default) leaves drafts that already have a bin alone. The registry item's
// bin follows, as with a hand edit.

const BIN_STATUSES = ["uploading", "ready", "review", "sent_back", "with_claude", "approved"];

export async function setBin(
  ids: string[],
  bin: string,
  onlyEmpty: boolean
): Promise<{ changed: number; hadBin: number; skipped: number; bin: string }> {
  const b = bin.trim().replace(/\s+/g, " ");
  if (!b) throw new Error("Type a bin / SKU first.");
  if (b.length > 120) throw new Error("That bin is too long.");
  const clean = Array.from(new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))).slice(0, 500);
  if (!clean.length) return { changed: 0, hadBin: 0, skipped: 0, bin: b };
  const found = await rows(sql`
    SELECT id, status, bin_sku, registry_item_id FROM listing_drafts
    WHERE id IN (${sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `)})`);
  let changed = 0;
  let hadBin = 0;
  let skipped = clean.length - found.length;
  for (const d of found) {
    if (!BIN_STATUSES.includes(String(d.status))) {
      skipped++;
      continue;
    }
    const cur = String(d.bin_sku ?? "").trim();
    if (cur === b) continue;
    if (onlyEmpty && cur) {
      hadBin++;
      continue;
    }
    await db.execute(sql`UPDATE listing_drafts SET bin_sku = ${b}, updated_at = now() WHERE id = ${String(d.id)}::uuid`);
    if (d.registry_item_id) {
      await db.execute(sql`UPDATE registry_items SET bin_sku = ${b}, updated_at = now() WHERE id = ${String(d.registry_item_id)}::uuid AND status = 'draft'`);
    }
    changed++;
  }
  return { changed, hadBin, skipped, bin: b };
}
