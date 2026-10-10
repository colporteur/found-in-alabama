// Shake-up report (Phase 5a): which live eBay items are due for their next
// 180-day freshening, what the next action is (lib/stale/rules.ts), and
// handing the chosen ones to the existing Expert Enhance pipeline (which
// revises the live eBay listing with ReviseItem and keeps a rollback
// snapshot). Bundles become a manual lot draft in Listings.
//
// Age is "at least": the earliest date FIA knows for the item (eBay start,
// Nifty capture, registry). Items that aren't on eBay aren't covered yet.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { createBatch } from "@/lib/enhance/queue";
import { DEFAULT_STALE_SETTINGS, markdownPrice, nextAction, parseStaleSettings, type StaleAction, type StaleSettings } from "./rules";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export async function staleReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.stale_actions') IS NOT NULL AS ok`);
  return !!r?.ok;
}

export async function staleSettings(): Promise<StaleSettings> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = 'staleRhythm'`);
  return r ? parseStaleSettings(r.value) : DEFAULT_STALE_SETTINGS;
}

export async function saveStaleSettings(raw: unknown): Promise<StaleSettings> {
  const s = parseStaleSettings(raw);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('staleRhythm', ${JSON.stringify(s)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  return s;
}

export type StaleItem = {
  itemId: string;
  registryItemId: string;
  title: string;
  sku: string | null;
  price: number | null;
  imageUrl: string | null;
  firstSeen: string | null;
  lastShake: string | null;
  rounds: number;
  daysOverdue: number;
  action: StaleAction;
  newPrice: number | null;
};

export type StaleReport = {
  settings: StaleSettings;
  live: number;
  due: number;
  dueSoon: number;
  byAction: Record<StaleAction, number>;
  items: StaleItem[];
  bundles: Array<{ bin: string; count: number; total: number; itemIds: string[]; titles: string[] }>;
};

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export async function staleReport(opts: { action?: StaleAction | null; bin?: string | null; limit?: number } = {}): Promise<StaleReport> {
  const s = await staleSettings();
  const list = await rows(sql`
    WITH base AS (
      SELECT el.item_id, el.title, el.sku, el.price, el.primary_image_url, r.id AS reg_id,
             LEAST(el.start_time, it.nifty_imported_at, it.created_at, r.created_at) AS first_seen,
             GREATEST(el.last_substantive_at, sa.last_at) AS last_shake,
             COALESCE(sa.rounds, 0)
               + CASE WHEN el.last_substantive_at IS NOT NULL AND (sa.last_at IS NULL OR el.last_substantive_at > sa.last_at) THEN 1 ELSE 0 END AS rounds
      FROM ebay_listings el
      JOIN registry_items r ON r.primary_ebay_item_id = el.item_id AND r.status = 'live'
      LEFT JOIN items it ON it.nifty_id = r.nifty_id
      LEFT JOIN LATERAL (
        SELECT max(x.created_at) AS last_at, count(*) FILTER (WHERE x.action <> 'skip')::int AS rounds
        FROM stale_actions x WHERE x.ebay_item_id = el.item_id) sa ON true
      WHERE el.quantity > 0)
    SELECT *, extract(epoch FROM now() - COALESCE(last_shake, first_seen)) / 86400 AS idle_days FROM base`);

  const live = list.length;
  let dueSoon = 0;
  const due: StaleItem[] = [];
  for (const r of list) {
    const idle = Number(r.idle_days ?? 0);
    if (idle < s.cycleDays) {
      if (idle >= s.cycleDays - 30) dueSoon++;
      continue;
    }
    const price = r.price == null ? null : Number(r.price);
    const rounds = Number(r.rounds ?? 0);
    const action = nextAction(rounds, price, s);
    due.push({
      itemId: String(r.item_id),
      registryItemId: String(r.reg_id),
      title: String(r.title ?? ""),
      sku: (r.sku as string | null) ?? null,
      price,
      imageUrl: (r.primary_image_url as string | null) ?? null,
      firstSeen: iso(r.first_seen),
      lastShake: iso(r.last_shake),
      rounds,
      daysOverdue: Math.floor(idle - s.cycleDays),
      action,
      newPrice: action === "markdown" && price != null ? markdownPrice(price, s) : null,
    });
  }
  due.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const byAction: Record<StaleAction, number> = { rewrite: 0, markdown: 0, describe: 0, bundle: 0 };
  for (const d of due) byAction[d.action]++;

  const groups = new Map<string, StaleItem[]>();
  for (const d of due.filter((x) => x.action === "bundle")) {
    const bin = (d.sku ?? "").trim() || "(no bin)";
    groups.set(bin, [...(groups.get(bin) ?? []), d]);
  }
  const bundles = Array.from(groups.entries())
    .filter(([, g]) => g.length >= s.bundleMinItems)
    .map(([bin, g]) => ({
      bin,
      count: g.length,
      total: Math.round(g.reduce((a, x) => a + (x.price ?? 0), 0) * 100) / 100,
      itemIds: g.map((x) => x.itemId),
      titles: g.map((x) => x.title),
    }))
    .sort((a, b) => b.count - a.count);

  const binFilter = (opts.bin ?? "").trim().toLowerCase();
  const items = due
    .filter((d) => (!opts.action || d.action === opts.action) && (!binFilter || (d.sku ?? "").toLowerCase() === binFilter))
    .slice(0, Math.min(opts.limit ?? 300, 1000));

  return { settings: s, live, due: due.length, dueSoon, byAction, items, bundles };
}

async function record(itemIds: string[], action: string, batchId: string | null, who: string, note: string | null) {
  if (!itemIds.length) return;
  await db.execute(sql`
    INSERT INTO stale_actions (ebay_item_id, registry_item_id, action, batch_id, note, created_by)
    SELECT el.item_id, r.id, ${action}, ${batchId}::uuid, ${note}, ${who}
    FROM unnest(${`{${itemIds.join(",")}}`}::text[]) AS i(id)
    JOIN ebay_listings el ON el.item_id = i.id
    LEFT JOIN registry_items r ON r.primary_ebay_item_id = el.item_id`);
}

async function listingItems(itemIds: string[]) {
  const clean = itemIds.filter((i) => /^\d{9,15}$/.test(i)).slice(0, 500);
  if (!clean.length) return [];
  return rows(sql`SELECT item_id, sku, title FROM ebay_listings WHERE item_id = ANY(${`{${clean.join(",")}}`}::text[])`);
}

/** Hand due items to Expert Enhance (live eBay revisions with rollback). */
export async function runShakeUp(p: {
  kind: "rewrite" | "describe" | "markdown" | "skip";
  itemIds: string[];
  guideId?: string | null;
  fillSpecifics?: boolean;
  who: string;
}): Promise<{ batches: Array<{ op: string; id: string; items: number }>; recorded: number }> {
  const found = await listingItems(p.itemIds);
  if (!found.length) throw new Error("None of those items are in the eBay mirror.");
  const ids = found.map((r) => String(r.item_id));
  const items = found.map((r) => ({ ebayItemId: String(r.item_id), sku: (r.sku as string | null) ?? null, title: (r.title as string | null) ?? null }));
  const out: Array<{ op: string; id: string; items: number }> = [];
  const s = await staleSettings();
  const label = (what: string) => `Shake-up: ${what} (${items.length})`;

  if (p.kind === "rewrite" || p.kind === "describe") {
    if (!p.guideId) throw new Error("Pick an Expert Guide for the rewrite.");
    const op = p.kind === "rewrite" ? "title_remix" : "description_remix";
    const b = await createBatch({ op, label: label(p.kind === "rewrite" ? "new titles" : "new descriptions"), config: { guideId: p.guideId }, items });
    out.push({ op, id: String((b as { id: string }).id), items: items.length });
    if (p.kind === "rewrite" && p.fillSpecifics) {
      const b2 = await createBatch({ op: "item_specifics", label: label("item specifics"), config: {}, items });
      out.push({ op: "item_specifics", id: String((b2 as { id: string }).id), items: items.length });
    }
  } else if (p.kind === "markdown") {
    const b = await createBatch({
      op: "price_adjust",
      label: label(`markdown ${s.markdownPct}%`),
      config: { mode: "percent", delta: -s.markdownPct, floor: s.floor, round87: true },
      items,
    });
    out.push({ op: "price_adjust", id: String((b as { id: string }).id), items: items.length });
  }
  await record(ids, p.kind, out[0]?.id ?? null, p.who, out.map((o) => o.op).join(", ") || null);
  return { batches: out, recorded: ids.length };
}

/** A lot of slow cheap items from one bin → a listing draft (status ready,
 *  so the writer can write it). Its photos start as the singles' eBay
 *  photos (one each, up to 12); a group photo is better if you take one. */
export async function makeLotDraft(itemIds: string[], who: string): Promise<string> {
  const found = await rows(sql`
    SELECT el.item_id, el.title, el.sku, el.price, el.primary_image_url FROM ebay_listings el
    WHERE el.item_id = ANY(${`{${itemIds.filter((i) => /^\d{9,15}$/.test(i)).slice(0, 100).join(",")}}`}::text[])
    ORDER BY el.title`);
  if (found.length < 2) throw new Error("A lot needs at least two items.");
  const bins = Array.from(new Set(found.map((r) => String(r.sku ?? "")).filter(Boolean)));
  const total = found.reduce((a, r) => a + Number(r.price ?? 0), 0);
  const lines = found.map((r) => `- ${r.title} (eBay ${r.item_id}, $${Number(r.price ?? 0).toFixed(2)})`).join("\n");
  const notes =
    `LOT from the shake-up report: ${found.length} items from bin ${bins.join(", ") || "?"}, singles total $${total.toFixed(2)}. ` +
    `Write it as one lot listing of all of these. When the lot goes live, END these single listings on eBay (Nifty delists the rest):\n${lines}`;
  const title = `Lot of ${found.length}: ${String(found[0].title ?? "").slice(0, 50)}`;
  const [item] = await rows(sql`
    INSERT INTO registry_items (status, title, title_normalized, bin_sku, created_from)
    VALUES ('draft', ${title}, ${title.toLowerCase().replace(/\s+/g, " ").trim()}, ${bins[0] ?? null}, 'intake')
    RETURNING id`);
  const [d] = await rows(sql`
    INSERT INTO listing_drafts (registry_item_id, status, source, source_label, title_hint, bin_sku, notes, quantity, facts, created_by)
    VALUES (${String(item.id)}, 'ready', 'manual', ${`Shake-up lot · bin ${bins.join(", ") || "mixed"}`}, ${title},
            ${bins[0] ?? null}, ${notes}, 1,
            ${JSON.stringify({ lot_of: found.length, lot_items: found.map((r) => String(r.item_id)), singles_total: Math.round(total * 100) / 100 })}::jsonb,
            ${who})
    RETURNING id`);
  const draftId = String(d.id);
  let pos = 1;
  for (const r of found.filter((x) => x.primary_image_url).slice(0, 12)) {
    await db.execute(sql`
      INSERT INTO draft_photos (draft_id, position, role, storage_key, url, original_name, content_type, uploaded_at)
      VALUES (${draftId}::uuid, ${pos}, ${pos === 1 ? "front" : "detail"}, ${`ebay-lot/${draftId}/${r.item_id}`},
              ${String(r.primary_image_url)}, ${`eBay ${r.item_id}`}, 'image/jpeg', now())`);
    pos++;
  }
  await record(found.map((r) => String(r.item_id)), "bundle", null, who, `lot draft ${draftId}`);
  return draftId;
}
