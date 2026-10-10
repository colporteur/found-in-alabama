// Inventory labels (Phase 4c): what goes on a DYMO 57 × 32 mm label — the
// item's title and price — for live registry items (by search or by bin) and
// for listing drafts (labelled at intake, before they're listed). Replaces
// the Nifty Inventory Label Printer, which read Nifty's inventory screen.
// Read-only.

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export type LabelItem = {
  /** "r:<registry id>" or "d:<draft id>" */
  key: string;
  title: string;
  price: number | null;
  binSku: string | null;
  imageUrl: string | null;
  status: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (ids: string[]) => sql`${`{${ids.filter((i) => UUID.test(i)).slice(0, 500).join(",")}}`}::uuid[]`;

/** The price a shopper sees: the eBay listing's price, else any live venue price. */
const REGISTRY_SELECT = sql`
  SELECT 'r:' || r.id::text AS key, r.title, r.bin_sku, r.status,
         COALESCE(el.price, vl.price) AS price,
         COALESCE(it.hero_image, el.primary_image_url) AS image_url
  FROM registry_items r
  LEFT JOIN ebay_listings el ON el.item_id = r.primary_ebay_item_id
  LEFT JOIN items it ON it.nifty_id = r.nifty_id
  LEFT JOIN LATERAL (
    SELECT v.price FROM venue_listings v
    WHERE v.registry_item_id = r.id AND v.price IS NOT NULL AND v.status IN ('live', 'active', 'listed')
    ORDER BY (v.venue = 'ebay') DESC LIMIT 1) vl ON true`;

const DRAFT_SELECT = sql`
  SELECT 'd:' || d.id::text AS key, COALESCE(d.title, d.title_hint) AS title, d.bin_sku, d.status, d.price,
         (SELECT p.url FROM draft_photos p WHERE p.draft_id = d.id ORDER BY p.position LIMIT 1) AS image_url
  FROM listing_drafts d`;

function toItem(r: Row): LabelItem {
  return {
    key: String(r.key),
    title: String(r.title ?? "").trim(),
    price: r.price == null ? null : Number(r.price),
    binSku: (r.bin_sku as string | null) ?? null,
    imageUrl: (r.image_url as string | null) ?? null,
    status: (r.status as string | null) ?? null,
  };
}

/** Live registry items by title words and/or bin (exact, case-insensitive). */
export async function searchInventory(q: string, bin: string, limit = 200): Promise<LabelItem[]> {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const binClean = bin.trim();
  if (!words.length && !binClean) return [];
  const conds = [sql`r.status = 'live'`];
  for (const w of words) conds.push(sql`r.title ILIKE ${`%${w}%`}`);
  if (binClean) conds.push(sql`upper(r.bin_sku) = upper(${binClean})`);
  const where = sql.join(conds, sql` AND `);
  const list = await rows(sql`${REGISTRY_SELECT} WHERE ${where} ORDER BY r.title LIMIT ${Math.min(limit, 500)}`);
  return list.map(toItem);
}

/** Listing drafts that have a title, newest first (labels at intake). */
export async function recentDrafts(limit = 200): Promise<LabelItem[]> {
  const list = await rows(sql`${DRAFT_SELECT}
    WHERE d.status NOT IN ('discarded') AND COALESCE(d.title, d.title_hint) IS NOT NULL
    ORDER BY d.updated_at DESC LIMIT ${Math.min(limit, 500)}`);
  return list.map(toItem);
}

/** Labels for the chosen keys, in the order given. */
export async function labelItems(keys: string[]): Promise<LabelItem[]> {
  const reg = keys.filter((k) => k.startsWith("r:")).map((k) => k.slice(2));
  const drafts = keys.filter((k) => k.startsWith("d:")).map((k) => k.slice(2));
  const found = new Map<string, LabelItem>();
  if (reg.length) for (const r of await rows(sql`${REGISTRY_SELECT} WHERE r.id = ANY(${uuids(reg)})`)) found.set(String(r.key), toItem(r));
  if (drafts.length) for (const r of await rows(sql`${DRAFT_SELECT} WHERE d.id = ANY(${uuids(drafts)})`)) found.set(String(r.key), toItem(r));
  return keys.map((k) => found.get(k)).filter((x): x is LabelItem => !!x && !!x.title);
}

/** Bins with live items, for the bin picker. */
export async function liveBins(): Promise<Array<{ bin: string; n: number }>> {
  const list = await rows(sql`
    SELECT bin_sku AS bin, count(*)::int AS n FROM registry_items
    WHERE status = 'live' AND bin_sku IS NOT NULL AND bin_sku <> ''
    GROUP BY bin_sku ORDER BY bin_sku`);
  return list.map((r) => ({ bin: String(r.bin), n: Number(r.n) }));
}
