// Books (Phase 4e): hauls (acquisitions), item cost basis, and profit per
// sale from the to-ship packages. FIA tables only; nothing leaves FIA.
//
// Item cost basis = registry_items.unit_cost when set, else the haul's
// total cost split evenly across the items tied to it, else unknown.
// Sales come from ship_orders (Phase 4a/4b), so the books start on the
// to-ship queue's start date.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { DEFAULT_BOOKS_SETTINGS, orderProfit, parseBooksSettings, type BooksSettings, type Profit } from "./fees";

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
  items: number;
  itemsSold: number;
  revenue: number;
};

export async function listAcquisitions(limit = 200): Promise<Acquisition[]> {
  const list = await rows(sql`
    SELECT a.*, to_char(a.acquired_on, 'YYYY-MM-DD') AS on_day,
      (SELECT count(*)::int FROM registry_items r WHERE r.acquisition_id = a.id) AS items,
      (SELECT count(*)::int FROM registry_items r WHERE r.acquisition_id = a.id AND r.status IN ('sold', 'shipped')) AS items_sold,
      (SELECT COALESCE(sum(l.price * l.quantity), 0) FROM ship_order_lines l
         JOIN ship_orders o ON o.id = l.order_id AND o.status NOT IN ('cancelled', 'merged')
         JOIN registry_items r ON r.id = l.registry_item_id
        WHERE r.acquisition_id = a.id) AS revenue
    FROM acquisitions a
    ORDER BY a.acquired_on DESC NULLS LAST, a.created_at DESC LIMIT ${limit}`);
  return list.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    acquiredOn: (r.on_day as string | null) ?? null,
    kind: (r.kind as string | null) ?? null,
    totalCost: numOrNull(r.total_cost),
    notes: (r.notes as string | null) ?? null,
    items: Number(r.items ?? 0),
    itemsSold: Number(r.items_sold ?? 0),
    revenue: Number(r.revenue ?? 0),
  }));
}

export async function saveAcquisition(input: {
  id?: string | null;
  name?: string;
  acquiredOn?: string | null;
  kind?: string | null;
  totalCost?: number | string | null;
  notes?: string | null;
}): Promise<string> {
  const name = String(input.name ?? "").trim().slice(0, 200);
  if (!name) throw new Error("Give the haul a name.");
  const day = input.acquiredOn && /^\d{4}-\d{2}-\d{2}$/.test(input.acquiredOn) ? input.acquiredOn : null;
  const kind = input.kind && (ACQ_KINDS as readonly string[]).includes(input.kind) ? input.kind : null;
  const cost = input.totalCost == null || input.totalCost === "" ? null : Number(input.totalCost);
  if (cost != null && (!Number.isFinite(cost) || cost < 0)) throw new Error("Total cost must be a number.");
  const notes = input.notes ? String(input.notes).slice(0, 2000) : null;
  if (input.id) {
    if (!UUID.test(input.id)) throw new Error("Bad haul id");
    await exec(sql`
      UPDATE acquisitions SET name = ${name}, acquired_on = ${day}::date, kind = ${kind},
        total_cost = ${cost}::numeric, notes = ${notes}, updated_at = now()
      WHERE id = ${input.id}::uuid`);
    return input.id;
  }
  const [r] = await rows(sql`
    INSERT INTO acquisitions (name, acquired_on, kind, total_cost, notes)
    VALUES (${name}, ${day}::date, ${kind}, ${cost}::numeric, ${notes}) RETURNING id`);
  return String(r.id);
}

// ─── item cost ───────────────────────────────────────────────────────────────

export type ItemCost = { acquisitionId: string | null; unitCost: number | null; splitCost: number | null };

export async function itemCost(registryItemId: string): Promise<ItemCost | null> {
  if (!UUID.test(registryItemId)) return null;
  const [r] = await rows(sql`
    SELECT r.acquisition_id, r.unit_cost,
      a.total_cost / NULLIF((SELECT count(*) FROM registry_items r2 WHERE r2.acquisition_id = a.id), 0) AS split
    FROM registry_items r LEFT JOIN acquisitions a ON a.id = r.acquisition_id
    WHERE r.id = ${registryItemId}::uuid`);
  if (!r) return null;
  return {
    acquisitionId: (r.acquisition_id as string | null) ?? null,
    unitCost: numOrNull(r.unit_cost),
    splitCost: r.split == null ? null : Math.round(Number(r.split) * 100) / 100,
  };
}

/** Tie an item to a haul (or none) and/or give it its own cost. Undefined =
 *  leave as is; null = clear. */
export async function setItemCost(
  registryItemIds: string[],
  edit: { acquisitionId?: string | null; unitCost?: number | string | null }
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
                  a.total_cost / NULLIF((SELECT count(*) FROM registry_items r2 WHERE r2.acquisition_id = a.id), 0)) * l.quantity)
          ORDER BY l.created_at)
        FROM ship_order_lines l
        LEFT JOIN registry_items r ON r.id = l.registry_item_id
        LEFT JOIN acquisitions a ON a.id = r.acquisition_id
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
