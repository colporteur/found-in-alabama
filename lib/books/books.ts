// Books (Phase 4e): hauls (acquisitions), item cost basis, and profit per
// sale from the to-ship packages. FIA tables only; nothing leaves FIA.
//
// Item cost basis = registry_items.unit_cost when set, else the haul's
// total cost split evenly across the items in it, else unknown.
//
// An item is in a haul when it was tied to it by hand (acquisition_id), or,
// failing that, when its journal slug (registry_items.haul_post_slug, from
// the Nifty Private Notes) is the haul's journal post (acquisitions.post_slug).
// Sales come from ship_orders (Phase 4a/4b), so the books start on the
// to-ship queue's start date.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { DEFAULT_BOOKS_SETTINGS, orderProfit, parseBooksSettings, type BooksSettings, type Profit } from "./fees";
import { getAllPosts } from "@/lib/posts";
import { getKnownSlugs } from "@/lib/posts-slugs";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
async function exec(q: ReturnType<typeof sql>): Promise<number> {
  const res = (await db.execute(q)) as { rowCount?: number | null };
  return res.rowCount ?? 0;
}
const numOrNull = (v: unknown) => (v == null || v === "" ? null : Number(v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,120}$/;

/** SQL: registry item alias `r` belongs to haul alias `a` — tied by hand, or
 *  (when not tied by hand) carrying the haul's journal slug. With post_slug
 *  unique, a LEFT JOIN on this matches at most one haul per item. */
export function inHaul(r: string, a: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(r) || !/^[a-z][a-z0-9_]*$/.test(a)) throw new Error("bad alias");
  return sql.raw(
    `(${r}.acquisition_id = ${a}.id OR (${r}.acquisition_id IS NULL AND ${a}.post_slug IS NOT NULL AND ${r}.haul_post_slug = ${a}.post_slug))`
  );
}

/** Published journal posts, newest first, for the haul pickers. */
export type JournalPost = { slug: string; title: string; date: string; type: string };
export function journalPosts(): JournalPost[] {
  try {
    return getAllPosts()
      .map((p) => ({ slug: p.slug, title: p.title, date: p.date, type: p.type }))
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  } catch {
    return [];
  }
}

/** "" / null → null; otherwise a published journal post slug, or an error. */
export function checkSlug(raw: unknown): string | null {
  const s = raw == null ? "" : String(raw).trim().toLowerCase();
  if (!s) return null;
  if (!SLUG.test(s)) throw new Error("That isn't a journal post slug.");
  if (!getKnownSlugs().has(s)) throw new Error(`No published journal post "${s}".`);
  return s;
}

export async function booksReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.acquisitions') IS NOT NULL AS ok`);
  return !!r?.ok;
}

// ─── settings ────────────────────────────────────────────────────────────────

export async function booksSettings(): Promise<BooksSettings> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = 'books'`);
  return r ? parseBooksSettings(r.value) : DEFAULT_BOOKS_SETTINGS;
}

export async function saveBooksSettings(raw: unknown): Promise<BooksSettings> {
  const s = parseBooksSettings(raw);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('books', ${JSON.stringify(s)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  return s;
}

// ─── hauls ───────────────────────────────────────────────────────────────────

export const ACQ_KINDS = ["estate_sale", "auction", "thrift", "yard_sale", "online", "other"] as const;

export type Acquisition = {
  id: string;
  name: string;
  acquiredOn: string | null;
  kind: string | null;
  totalCost: number | null;
  notes: string | null;
  postSlug: string | null;
  items: number;
  /** Of `items`, how many are in it through the journal slug only. */
  itemsViaJournal: number;
  itemsSold: number;
  revenue: number;
  /** Unsold items (not sold, shipped or archived) and their asking prices. */
  itemsUnsold: number;
  unsoldAsking: number;
  /** Unsold items with no asking price yet (e.g. drafts not priced). */
  unsoldUnpriced: number;
};

// An item's asking price: its Nifty capture price, else its newest priced
// venue listing that hasn't ended (eBay first). Joined as "ap" on registry_items r.
const askingPrice = sql.raw(`LEFT JOIN LATERAL (SELECT COALESCE(
    (SELECT i.price FROM items i WHERE i.id = r.nifty_item_ref),
    (SELECT v.price FROM venue_listings v
      WHERE v.registry_item_id = r.id AND v.price IS NOT NULL AND v.status <> 'ended'
      ORDER BY (v.venue = 'ebay') DESC, v.updated_at DESC LIMIT 1)) AS price) ap ON true`);

export async function listAcquisitions(limit = 200): Promise<Acquisition[]> {
  const list = await rows(sql`
    SELECT a.*, to_char(a.acquired_on, 'YYYY-MM-DD') AS on_day,
      (SELECT count(*)::int FROM registry_items r WHERE ${inHaul("r", "a")}) AS items,
      (SELECT count(*)::int FROM registry_items r WHERE r.acquisition_id IS NULL AND a.post_slug IS NOT NULL
         AND r.haul_post_slug = a.post_slug) AS items_via_journal,
      (SELECT count(*)::int FROM registry_items r WHERE ${inHaul("r", "a")} AND r.status IN ('sold', 'shipped')) AS items_sold,
      (SELECT COALESCE(sum(l.price * l.quantity), 0) FROM ship_order_lines l
         JOIN ship_orders o ON o.id = l.order_id AND o.status NOT IN ('cancelled', 'merged')
         JOIN registry_items r ON r.id = l.registry_item_id
        WHERE ${inHaul("r", "a")}) AS revenue,
      (SELECT count(*)::int FROM registry_items r
        WHERE ${inHaul("r", "a")} AND r.status NOT IN ('sold', 'shipped', 'archived')) AS items_unsold,
      (SELECT COALESCE(sum(ap.price), 0) FROM registry_items r ${askingPrice}
        WHERE ${inHaul("r", "a")} AND r.status NOT IN ('sold', 'shipped', 'archived')) AS unsold_asking,
      (SELECT count(*)::int FROM registry_items r ${askingPrice}
        WHERE ${inHaul("r", "a")} AND r.status NOT IN ('sold', 'shipped', 'archived') AND ap.price IS NULL) AS unsold_unpriced
    FROM acquisitions a
    ORDER BY a.acquired_on DESC NULLS LAST, a.created_at DESC LIMIT ${limit}`);
  return list.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    acquiredOn: (r.on_day as string | null) ?? null,
    kind: (r.kind as string | null) ?? null,
    totalCost: numOrNull(r.total_cost),
    notes: (r.notes as string | null) ?? null,
    postSlug: (r.post_slug as string | null) ?? null,
    items: Number(r.items ?? 0),
    itemsViaJournal: Number(r.items_via_journal ?? 0),
    itemsSold: Number(r.items_sold ?? 0),
    revenue: Number(r.revenue ?? 0),
    itemsUnsold: Number(r.items_unsold ?? 0),
    unsoldAsking: Number(r.unsold_asking ?? 0),
    unsoldUnpriced: Number(r.unsold_unpriced ?? 0),
  }));
}

export async function saveAcquisition(input: {
  id?: string | null;
  name?: string;
  acquiredOn?: string | null;
  kind?: string | null;
  totalCost?: number | string | null;
  notes?: string | null;
  /** Journal post slug; "" or null = none. */
  postSlug?: string | null;
}): Promise<string> {
  const name = String(input.name ?? "").trim().slice(0, 200);
  if (!name) throw new Error("Give the haul a name.");
  const day = input.acquiredOn && /^\d{4}-\d{2}-\d{2}$/.test(input.acquiredOn) ? input.acquiredOn : null;
  const kind = input.kind && (ACQ_KINDS as readonly string[]).includes(input.kind) ? input.kind : null;
  const cost = input.totalCost == null || input.totalCost === "" ? null : Number(input.totalCost);
  if (cost != null && (!Number.isFinite(cost) || cost < 0)) throw new Error("Total cost must be a number.");
  const notes = input.notes ? String(input.notes).slice(0, 2000) : null;
  const slug = checkSlug(input.postSlug);
  try {
    if (input.id) {
      if (!UUID.test(input.id)) throw new Error("Bad haul id");
      await exec(sql`
        UPDATE acquisitions SET name = ${name}, acquired_on = ${day}::date, kind = ${kind},
          total_cost = ${cost}::numeric, notes = ${notes}, post_slug = ${slug}, updated_at = now()
        WHERE id = ${input.id}::uuid`);
      return input.id;
    }
    const [r] = await rows(sql`
      INSERT INTO acquisitions (name, acquired_on, kind, total_cost, notes, post_slug)
      VALUES (${name}, ${day}::date, ${kind}, ${cost}::numeric, ${notes}, ${slug}) RETURNING id`);
    return String(r.id);
  } catch (err) {
    if (/acquisitions_post_slug_uq|duplicate key/i.test(String((err as Error).message))) {
      throw new Error("Another haul is already tied to that journal post.");
    }
    throw err;
  }
}

// ─── item cost ───────────────────────────────────────────────────────────────

export type ItemCost = {
  /** Haul picked by hand (null = none picked). */
  acquisitionId: string | null;
  /** The haul it counts toward: the one picked, else the one for its journal post. */
  haulId: string | null;
  haulName: string | null;
  /** Its journal post slug (goes first in the Nifty Private Notes). */
  haulPostSlug: string | null;
  unitCost: number | null;
  splitCost: number | null;
};

export async function itemCost(registryItemId: string): Promise<ItemCost | null> {
  if (!UUID.test(registryItemId)) return null;
  const [r] = await rows(sql`
    SELECT r.acquisition_id, r.unit_cost, r.haul_post_slug, a.id AS haul_id, a.name AS haul_name,
      a.total_cost / NULLIF((SELECT count(*) FROM registry_items r2 WHERE ${inHaul("r2", "a")}), 0) AS split
    FROM registry_items r LEFT JOIN acquisitions a ON ${inHaul("r", "a")}
    WHERE r.id = ${registryItemId}::uuid`);
  if (!r) return null;
  return {
    acquisitionId: (r.acquisition_id as string | null) ?? null,
    haulId: (r.haul_id as string | null) ?? null,
    haulName: (r.haul_name as string | null) ?? null,
    haulPostSlug: (r.haul_post_slug as string | null) ?? null,
    unitCost: numOrNull(r.unit_cost),
    splitCost: r.split == null ? null : Math.round(Number(r.split) * 100) / 100,
  };
}

/** Tie an item to a haul (or none) and/or give it its own cost. Undefined =
 *  leave as is; null = clear. */
export async function setItemCost(
  registryItemIds: string[],
  edit: { acquisitionId?: string | null; unitCost?: number | string | null; haulPostSlug?: string | null }
): Promise<number> {
  const ids = registryItemIds.filter((i) => UUID.test(i)).slice(0, 500);
  if (!ids.length) return 0;
  const sets = [];
  if (edit.acquisitionId !== undefined) {
    if (edit.acquisitionId !== null && !UUID.test(edit.acquisitionId)) throw new Error("Bad haul id");
    sets.push(sql`acquisition_id = ${edit.acquisitionId}::uuid`);
  }
  if (edit.unitCost !== undefined) {
    const c = edit.unitCost === null || edit.unitCost === "" ? null : Number(edit.unitCost);
    if (c != null && (!Number.isFinite(c) || c < 0)) throw new Error("Cost must be a number.");
    sets.push(sql`unit_cost = ${c}::numeric`);
  }
  if (edit.haulPostSlug !== undefined) {
    sets.push(sql`haul_post_slug = ${checkSlug(edit.haulPostSlug)}`);
  }
  if (!sets.length) return 0;
  sets.push(sql`updated_at = now()`);
  return exec(sql`UPDATE registry_items SET ${sql.join(sets, sql`, `)} WHERE id = ANY(${`{${ids.join(",")}}`}::uuid[])`);
}

export async function setShippingCost(orderId: string, cost: number | string | null): Promise<number> {
  if (!UUID.test(orderId)) return 0;
  const c = cost === null || cost === "" ? null : Number(cost);
  if (c != null && (!Number.isFinite(c) || c < 0)) throw new Error("Postage must be a number.");
  return exec(sql`UPDATE ship_orders SET shipping_cost = ${c}::numeric, updated_at = now() WHERE id = ${orderId}::uuid`);
}

/** Set (slug) or clear (null) the journal haul of a listing draft's item.
 *  Used by Claude's listing tools — only when Todd says which haul it is. */
export async function setDraftHaul(draftId: string, haul: string | null) {
  if (!UUID.test(draftId)) throw new Error("draft_id must be a draft uuid");
  const slug = checkSlug(haul);
  const [d] = await rows(sql`
    SELECT registry_item_id, nifty_item_id, status FROM listing_drafts WHERE id = ${draftId}::uuid`);
  if (!d) throw new Error("No such draft.");
  if (!d.registry_item_id) throw new Error("This draft has no item record, so it can't carry a haul.");
  await setItemCost([String(d.registry_item_id)], { haulPostSlug: slug });
  const cost = await itemCost(String(d.registry_item_id));
  const title = slug ? journalPosts().find((p) => p.slug === slug)?.title ?? slug : null;
  const sent = !!d.nifty_item_id;
  return {
    haul: slug,
    journalPost: title,
    booksHaul: cost?.haulName ?? null,
    note: !slug
      ? "Journal haul cleared."
      : sent
      ? `Set. This draft is already in Nifty, so its Private Notes there don't change — Todd should put "${slug}" first in Private Notes in Nifty.`
      : `Set. "${slug}" will go first in Nifty Private Notes when the draft is sent.${
          cost?.haulName ? ` It counts toward the books haul "${cost.haulName}".` : " No books haul is tied to this post yet."
        }`,
  };
}

/** The journal haul of a draft's item (for showing Claude what's set). */
export async function draftHaul(draftId: string): Promise<{ slug: string | null; title: string | null }> {
  if (!UUID.test(draftId)) return { slug: null, title: null };
  const [r] = await rows(sql`
    SELECT COALESCE(r.haul_post_slug, a.post_slug) AS slug
    FROM listing_drafts d JOIN registry_items r ON r.id = d.registry_item_id
    LEFT JOIN acquisitions a ON a.id = r.acquisition_id
    WHERE d.id = ${draftId}::uuid`);
  const slug = (r?.slug as string | null) ?? null;
  return { slug, title: slug ? journalPosts().find((p) => p.slug === slug)?.title ?? null : null };
}

// ─── month report ────────────────────────────────────────────────────────────

export type BookLine = { title: string; binSku: string | null; qty: number; price: number | null; cost: number | null };
export type BookOrder = {
  id: string;
  venue: string;
  venueOrderId: string | null;
  soldAt: string | null;
  status: string;
  shippingCostEntered: number | null;
  lines: BookLine[];
} & Profit;

export type MonthReport = {
  month: string;
  orders: BookOrder[];
  totals: { orders: number; revenue: number; fees: number; shipping: number; itemCost: number; profit: number; incomplete: number };
  byVenue: Array<{ venue: string; orders: number; revenue: number; profit: number }>;
};

export async function monthReport(month: string): Promise<MonthReport> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("month must be YYYY-MM");
  const s = await booksSettings();
  const start = sql`((${`${month}-01`}::date)::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`;
  const end = sql`(((${`${month}-01`}::date + interval '1 month')::date)::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`;
  const list = await rows(sql`
    SELECT o.id, o.venue, o.venue_order_id, o.sold_at, o.status, o.shipping_paid, o.venue_fees, o.shipping_cost,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'title', l.title, 'bin', l.bin_sku, 'qty', l.quantity, 'price', l.price,
          'cost', COALESCE(r.unit_cost,
                  a.total_cost / NULLIF((SELECT count(*) FROM registry_items r2 WHERE ${inHaul("r2", "a")}), 0)) * l.quantity)
          ORDER BY l.created_at)
        FROM ship_order_lines l
        LEFT JOIN registry_items r ON r.id = l.registry_item_id
        LEFT JOIN acquisitions a ON ${inHaul("r", "a")}
        WHERE l.order_id = o.id), '[]'::jsonb) AS lines
    FROM ship_orders o
    WHERE o.status NOT IN ('cancelled', 'merged') AND o.sold_at >= ${start} AND o.sold_at < ${end}
      AND EXISTS (SELECT 1 FROM ship_order_lines l WHERE l.order_id = o.id)
    ORDER BY o.sold_at`);

  const orders: BookOrder[] = list.map((r) => {
    const lines = ((r.lines as Row[]) ?? []).map((l) => ({
      title: String(l.title ?? "(no title)"),
      binSku: (l.bin as string | null) ?? null,
      qty: Number(l.qty ?? 1),
      price: numOrNull(l.price),
      cost: l.cost == null ? null : Math.round(Number(l.cost) * 100) / 100,
    }));
    const p = orderProfit(
      {
        venue: String(r.venue),
        itemsTotal: lines.reduce((a, l) => a + (l.price ?? 0) * l.qty, 0),
        shippingPaid: numOrNull(r.shipping_paid),
        actualFees: numOrNull(r.venue_fees),
        shippingCost: numOrNull(r.shipping_cost),
        itemCost: lines.reduce((a, l) => a + (l.cost ?? 0), 0),
        unknownCostLines: lines.filter((l) => l.cost == null).length,
      },
      s
    );
    const sold = r.sold_at instanceof Date ? r.sold_at.toISOString() : r.sold_at == null ? null : String(r.sold_at);
    return {
      id: String(r.id),
      venue: String(r.venue),
      venueOrderId: (r.venue_order_id as string | null) ?? null,
      soldAt: sold,
      status: String(r.status),
      shippingCostEntered: numOrNull(r.shipping_cost),
      lines,
      ...p,
    };
  });

  const sum = (f: (o: BookOrder) => number) => Math.round(orders.reduce((a, o) => a + f(o), 0) * 100) / 100;
  const venues = new Map<string, { venue: string; orders: number; revenue: number; profit: number }>();
  for (const o of orders) {
    const v = venues.get(o.venue) ?? { venue: o.venue, orders: 0, revenue: 0, profit: 0 };
    v.orders++;
    v.revenue = Math.round((v.revenue + o.revenue) * 100) / 100;
    v.profit = Math.round((v.profit + o.profit) * 100) / 100;
    venues.set(o.venue, v);
  }
  return {
    month,
    orders,
    totals: {
      orders: orders.length,
      revenue: sum((o) => o.revenue),
      fees: sum((o) => o.fees),
      shipping: sum((o) => o.shippingCost ?? 0),
      itemCost: sum((o) => o.itemCost),
      profit: sum((o) => o.profit),
      incomplete: orders.filter((o) => o.incomplete).length,
    },
    byVenue: Array.from(venues.values()).sort((a, b) => b.revenue - a.revenue),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function reportCsv(r: MonthReport): string {
  const head = ["sold_at", "venue", "order", "items", "bins", "revenue", "fees", "fees_estimated", "postage", "item_cost", "profit", "incomplete"];
  const lines = r.orders.map((o) =>
    [
      o.soldAt,
      o.venue,
      o.venueOrderId,
      o.lines.map((l) => (l.qty > 1 ? `${l.qty}x ${l.title}` : l.title)).join(" | "),
      o.lines.map((l) => l.binSku ?? "").join(" | "),
      o.revenue.toFixed(2),
      o.fees.toFixed(2),
      o.feesEstimated ? "yes" : "no",
      o.shippingCost == null ? "" : o.shippingCost.toFixed(2),
      o.itemCost.toFixed(2),
      o.profit.toFixed(2),
      o.incomplete ? "yes" : "no",
    ]
      .map(csvCell)
      .join(",")
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}
