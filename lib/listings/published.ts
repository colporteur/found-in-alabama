// "In Nifty" → "Published": once Todd publishes a draft from Nifty, its eBay
// listing shows up in FIA's eBay mirror. This finds it, links it to the
// draft's registry item (folding in the eBay-only duplicate the registry
// sync may already have made for it) and marks the draft published.
// Runs with the registry sync and the 5-minute sales sync, and from the
// draft page ("Mark as listed", with an eBay item id when the title was
// changed in Nifty). Touches FIA's own tables only.

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

/** Tables that point at a registry item, for folding a duplicate in. */
const REFS = ["venue_listings", "sale_events", "delist_plans", "ship_order_lines", "stale_actions", "registry_review", "registry_item_edits"];

async function existing(tables: string[]): Promise<string[]> {
  const found = await rows(sql`
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'registry_item_id' AND table_schema = 'public'
      AND table_name IN (${sql.join(tables.map((t) => sql`${t}`), sql`, `)})`);
  return found.map((r) => String(r.table_name));
}

/** Link one draft to one eBay listing and mark it published. */
async function link(draftId: string, ebayItemId: string, how: string): Promise<{ ok: boolean; error?: string }> {
  const [d] = await rows(sql`SELECT id, status, registry_item_id, nifty_item_id FROM listing_drafts WHERE id = ${draftId}::uuid`);
  if (!d) return { ok: false, error: "Draft not found" };
  if (!["in_nifty", "approved"].includes(String(d.status))) return { ok: false, error: `The draft is ${d.status}` };
  const [e] = await rows(sql`SELECT item_id, quantity FROM ebay_listings WHERE item_id = ${ebayItemId}`);
  if (!e) return { ok: false, error: `eBay item ${ebayItemId} isn't in FIA's eBay mirror yet (it syncs every 15 minutes)` };
  const mine = d.registry_item_id ? String(d.registry_item_id) : null;

  if (mine) {
    const [other] = await rows(sql`
      SELECT id, created_from, status, sold_at, sold_on_venue FROM registry_items
      WHERE primary_ebay_item_id = ${ebayItemId} AND id <> ${mine}::uuid`);
    if (other && String(other.created_from) !== "ebay_backfill") {
      return { ok: false, error: "That eBay listing already belongs to another item in the registry" };
    }
    if (other) {
      // The registry sync saw the new eBay listing first and made an
      // eBay-only row for it. Fold it into the draft's row.
      const dup = String(other.id);
      for (const t of await existing(REFS)) {
        await db.execute(sql`UPDATE ${sql.raw(t)} SET registry_item_id = ${mine}::uuid WHERE registry_item_id = ${dup}::uuid`);
      }
      await db.execute(sql`DELETE FROM registry_items WHERE id = ${dup}::uuid AND created_from = 'ebay_backfill'`);
      if (String(other.status) === "sold") {
        await db.execute(sql`
          UPDATE registry_items SET status = 'sold', sold_at = ${other.sold_at as string | null}, sold_on_venue = ${other.sold_on_venue as string | null}
          WHERE id = ${mine}::uuid`);
      }
    }
    await db.execute(sql`
      UPDATE registry_items SET primary_ebay_item_id = ${ebayItemId},
        status = CASE WHEN status = 'draft' THEN 'live' ELSE status END,
        nifty_id = COALESCE(nifty_id, ${(d.nifty_item_id as string | null) ?? null}), updated_at = now()
      WHERE id = ${mine}::uuid`);
    await db.execute(sql`
      INSERT INTO venue_listings (registry_item_id, venue, venue_listing_id, url, status, link_source)
      VALUES (${mine}::uuid, 'ebay', ${ebayItemId}, ${`https://www.ebay.com/itm/${ebayItemId}`},
              ${Number(e.quantity ?? 0) > 0 ? "live" : "sold"}, 'listing_draft')
      ON CONFLICT (venue, venue_listing_id) DO UPDATE SET registry_item_id = EXCLUDED.registry_item_id, updated_at = now()`);
  }
  await db.execute(sql`
    UPDATE listing_drafts SET status = 'published', updated_at = now(),
      ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('ebayItemId', ${ebayItemId}::text, 'publishedAt', now(), 'publishedHow', ${how}::text)
    WHERE id = ${draftId}::uuid`);
  return { ok: true };
}

/** Find the eBay listings of drafts Todd published from Nifty. Matches on
 *  the exact title (Nifty keeps FIA's title) of a listing started after the
 *  draft went to Nifty, or on Nifty's own capture of the item. */
export async function linkPublishedDrafts(): Promise<{ linked: number; checked: number }> {
  const found = await rows(sql`
    SELECT d.id, COALESCE(cap.eid, ttl.item_id) AS item_id, CASE WHEN cap.eid IS NOT NULL THEN 'nifty_capture' ELSE 'title' END AS how
    FROM listing_drafts d
    LEFT JOIN LATERAL (
      SELECT substring(i.marketplace_urls->>'ebay' from '/itm/(\\d+)') AS eid FROM items i
      WHERE d.nifty_item_id IS NOT NULL AND i.nifty_id = d.nifty_item_id LIMIT 1) cap ON true
    LEFT JOIN LATERAL (
      SELECT e.item_id FROM ebay_listings e
      WHERE d.title IS NOT NULL
        -- The mirror keeps eBay's HTML entities (Goldenson&apos;s).
        AND lower(trim(replace(replace(replace(replace(e.title, '&apos;', ''''), '&#39;', ''''), '&quot;', '"'), '&amp;', '&')))
            = lower(trim(d.title))
        AND e.start_time >= COALESCE(d.nifty_sent_at, d.approved_at, d.created_at) - interval '1 hour'
        AND NOT EXISTS (SELECT 1 FROM registry_items o WHERE o.primary_ebay_item_id = e.item_id AND o.created_from <> 'ebay_backfill'
                          AND o.id IS DISTINCT FROM d.registry_item_id)
      ORDER BY (e.sku IS NOT DISTINCT FROM d.bin_sku) DESC, e.start_time
      LIMIT 2) ttl ON true
    WHERE d.status = 'in_nifty'
      AND COALESCE(cap.eid, ttl.item_id) IS NOT NULL`);
  // A title that matched two new listings is ambiguous — leave it for Todd.
  const counts = new Map<string, number>();
  for (const f of found) counts.set(String(f.id), (counts.get(String(f.id)) ?? 0) + 1);
  let linked = 0;
  const done = new Set<string>();
  for (const f of found) {
    const id = String(f.id);
    if (done.has(id) || (f.how === "title" && (counts.get(id) ?? 0) > 1)) continue;
    done.add(id);
    const r = await link(id, String(f.item_id), String(f.how)).catch(() => ({ ok: false }));
    if (r.ok) linked++;
  }
  const [c] = await rows(sql`SELECT count(*)::int AS n FROM listing_drafts WHERE status = 'in_nifty'`);
  return { linked, checked: Number(c?.n ?? 0) };
}

/** Draft page: "Mark as listed" (optionally with the eBay item id or link). */
export async function markListed(draftId: string, ebayRef: string | null): Promise<{ ok: boolean; error?: string; linked?: string | null }> {
  const ref = (ebayRef ?? "").trim();
  if (ref) {
    const m = ref.match(/(\d{9,15})/);
    if (!m) return { ok: false, error: "That doesn't look like an eBay item number or link" };
    const r = await link(draftId, m[1], "by_hand");
    return { ...r, linked: r.ok ? m[1] : null };
  }
  // No id: try the automatic match first, then just mark it.
  await linkPublishedDrafts();
  const [d] = await rows(sql`SELECT status, ai_meta->>'ebayItemId' AS eid FROM listing_drafts WHERE id = ${draftId}::uuid`);
  if (!d) return { ok: false, error: "Draft not found" };
  if (String(d.status) === "published") return { ok: true, linked: (d.eid as string | null) ?? null };
  if (!["in_nifty", "approved"].includes(String(d.status))) return { ok: false, error: `The draft is ${d.status}` };
  await db.execute(sql`
    UPDATE listing_drafts SET status = 'published', updated_at = now(),
      ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('publishedAt', now(), 'publishedHow', 'by_hand_unlinked')
    WHERE id = ${draftId}::uuid`);
  await db.execute(sql`
    UPDATE registry_items SET status = 'live', updated_at = now()
    WHERE id = (SELECT registry_item_id FROM listing_drafts WHERE id = ${draftId}::uuid) AND status = 'draft'`);
  return { ok: true, linked: null };
}
