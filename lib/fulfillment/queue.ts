// The to-ship queue (Phase 4a). Built from sale_events, so every venue's
// sales land in one list; ship_orders holds what's been picked, packed and
// shipped (this replaces the Nifty Pick List's local "already included"
// history). Writes ONLY ship_orders / ship_order_lines / app_settings
// "fulfillment" — nothing is sent to any marketplace.
//
// Grouping today: a website order (Stripe) or a Hip sale is one package with
// all its lines; every marketplace sale is its own package until buyer
// capture (4b) can combine them.
//
// syncShipQueue() is idempotent; it runs on page load and after each
// sales-sync.

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
async function exec(q: ReturnType<typeof sql>): Promise<number> {
  const res = (await db.execute(q)) as { rowCount?: number | null };
  return res.rowCount ?? 0;
}

export type FulfillmentSettings = {
  /** Sales before this day (America/Chicago) never enter the queue. */
  startDate: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFulfillmentSettings(raw: unknown): FulfillmentSettings {
  const v = (raw ?? {}) as Record<string, unknown>;
  const d = typeof v.startDate === "string" && DATE_RE.test(v.startDate) ? v.startDate : null;
  return { startDate: d };
}

export async function shipTablesReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.ship_orders') IS NOT NULL AS ok`);
  return !!r?.ok;
}

export async function fulfillmentSettings(): Promise<FulfillmentSettings> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = 'fulfillment'`);
  return parseFulfillmentSettings(r?.value ?? null);
}

export async function saveFulfillmentSettings(raw: unknown): Promise<FulfillmentSettings> {
  const s = parseFulfillmentSettings(raw);
  if (!s.startDate) throw new Error("startDate must be YYYY-MM-DD");
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('fulfillment', ${JSON.stringify(s)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  return s;
}

/** Package key for a sale: its website order, its Hip sale, or itself. */
const ORDER_KEY = sql.raw(`CASE
    WHEN e.source = 'stripe' AND e.order_ref IS NOT NULL THEN 'stripe:' || e.order_ref
    WHEN e.source = 'hip' THEN 'hip:' || e.source_ref
    ELSE 'sale:' || e.id::text END`);

export type SyncResult = { ready: boolean; orders: number; lines: number; refreshed: number; dropped: number; shipped: number };

export async function syncShipQueue(): Promise<SyncResult> {
  const none = { orders: 0, lines: 0, refreshed: 0, dropped: 0, shipped: 0 };
  if (!(await shipTablesReady())) return { ready: false, ...none };
  const { startDate } = await fulfillmentSettings();
  if (!startDate) return { ready: false, ...none };
  const since = sql`((${startDate}::date)::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`;

  // 1. one package per order key
  const orders = await exec(sql`
    INSERT INTO ship_orders (venue, order_key, venue_order_id, buyer_name, sold_at)
    SELECT k.venue, k.order_key, min(k.venue_order_id), min(t.shipping_name), min(k.sold_at)
    FROM (
      SELECT e.venue, ${ORDER_KEY} AS order_key,
             CASE WHEN e.source = 'hip' THEN e.source_ref ELSE e.order_ref END AS venue_order_id,
             CASE WHEN e.source = 'stripe' THEN e.order_ref
                  WHEN e.source = 'hip' THEN (SELECT h.tes_order_id::text FROM hip_sales h WHERE h.hip_sale_id::text = e.source_ref)
             END AS tes_order_id,
             COALESCE(e.sold_at, e.detected_at) AS sold_at
      FROM sale_events e
      WHERE e.status NOT IN ('duplicate', 'ignored')
        AND COALESCE(e.sold_at, e.detected_at) >= ${since}
    ) k
    LEFT JOIN tes_orders t ON t.id::text = k.tes_order_id
    GROUP BY k.venue, k.order_key
    ON CONFLICT (venue, order_key) DO NOTHING`);

  // 2. its lines (title, bin, photo from the registry when matched)
  const lines = await exec(sql`
    INSERT INTO ship_order_lines (order_id, sale_event_id, registry_item_id, title, bin_sku, quantity, price, image_url)
    SELECT o.id, e.id, e.registry_item_id, COALESCE(r.title, e.title), r.bin_sku,
           COALESCE(ti.quantity, 1), e.price,
           COALESCE(it.hero_image, el.primary_image_url, ti.image_url)
    FROM sale_events e
    JOIN ship_orders o ON o.venue = e.venue AND o.order_key = ${ORDER_KEY}
    LEFT JOIN registry_items r ON r.id = e.registry_item_id
    LEFT JOIN items it ON it.nifty_id = r.nifty_id
    LEFT JOIN ebay_listings el ON el.item_id = COALESCE(e.ebay_item_id, r.primary_ebay_item_id)
    LEFT JOIN tes_order_items ti ON e.source = 'stripe' AND ti.id::text = e.source_ref
    WHERE e.status NOT IN ('duplicate', 'ignored')
      AND COALESCE(e.sold_at, e.detected_at) >= ${since}
    ON CONFLICT (sale_event_id) DO NOTHING`);

  // 3. sales matched after they were queued: fill in bin, title, photo
  const refreshed = await exec(sql`
    UPDATE ship_order_lines l
    SET registry_item_id = e.registry_item_id,
        title = COALESCE(r.title, l.title),
        bin_sku = r.bin_sku,
        image_url = COALESCE(l.image_url, it.hero_image, el.primary_image_url)
    FROM sale_events e
    JOIN registry_items r ON r.id = e.registry_item_id
    LEFT JOIN items it ON it.nifty_id = r.nifty_id
    LEFT JOIN ebay_listings el ON el.item_id = COALESCE(e.ebay_item_id, r.primary_ebay_item_id)
    WHERE l.sale_event_id = e.id AND l.registry_item_id IS DISTINCT FROM e.registry_item_id`);

  // 4. sales later marked duplicate / ignored leave packages not yet packed
  const dropped = await exec(sql`
    DELETE FROM ship_order_lines l
    USING sale_events e, ship_orders o
    WHERE l.sale_event_id = e.id AND o.id = l.order_id
      AND e.status IN ('duplicate', 'ignored') AND o.status = 'to_pick'`);
  await exec(sql`
    UPDATE ship_orders o SET status = 'cancelled', updated_at = now(), updated_by = 'sync'
    WHERE o.status = 'to_pick' AND NOT EXISTS (SELECT 1 FROM ship_order_lines l WHERE l.order_id = o.id)`);

  // 5. website / Hip orders shipped (or refunded) on the TES orders page
  const shipped = await exec(sql`
    UPDATE ship_orders o
    SET status = CASE WHEN t.status IN ('refunded', 'canceled', 'cancelled') THEN 'cancelled' ELSE 'shipped' END,
        shipped_at = COALESCE(o.shipped_at, t.shipped_at),
        tracking_number = COALESCE(o.tracking_number, t.tracking_number),
        carrier = COALESCE(o.carrier, t.carrier),
        updated_at = now(), updated_by = 'sync'
    FROM tes_orders t
    WHERE o.status IN ('to_pick', 'packed')
      AND t.id::text = CASE
            WHEN o.order_key LIKE 'stripe:%' THEN substr(o.order_key, 8)
            WHEN o.order_key LIKE 'hip:%' THEN (SELECT h.tes_order_id::text FROM hip_sales h WHERE h.hip_sale_id::text = substr(o.order_key, 5))
          END
      AND (t.shipped_at IS NOT NULL OR t.status IN ('refunded', 'canceled', 'cancelled'))`);

  return { ready: true, orders, lines, refreshed, dropped, shipped };
}

export type ShipLine = {
  id: string;
  title: string | null;
  binSku: string | null;
  quantity: number;
  price: number | null;
  imageUrl: string | null;
  registryItemId: string | null;
  saleEventId: string | null;
};

export type ShipOrder = {
  id: string;
  venue: string;
  orderKey: string;
  venueOrderId: string | null;
  buyerName: string | null;
  soldAt: string | null;
  status: string;
  pickPrintedAt: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  trackingNumber: string | null;
  lines: ShipLine[];
};

function toOrder(r: Row): ShipOrder {
  const lines = (Array.isArray(r.lines) ? r.lines : []) as Row[];
  const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  return {
    id: String(r.id),
    venue: String(r.venue),
    orderKey: String(r.order_key),
    venueOrderId: (r.venue_order_id as string | null) ?? null,
    buyerName: (r.buyer_name as string | null) ?? null,
    soldAt: iso(r.sold_at),
    status: String(r.status),
    pickPrintedAt: iso(r.pick_printed_at),
    packedAt: iso(r.packed_at),
    shippedAt: iso(r.shipped_at),
    trackingNumber: (r.tracking_number as string | null) ?? null,
    lines: lines.map((l) => ({
      id: String(l.id),
      title: (l.title as string | null) ?? null,
      binSku: (l.bin_sku as string | null) ?? null,
      quantity: Number(l.quantity ?? 1),
      price: l.price == null ? null : Number(l.price),
      imageUrl: (l.image_url as string | null) ?? null,
      registryItemId: (l.registry_item_id as string | null) ?? null,
      saleEventId: (l.sale_event_id as string | null) ?? null,
    })),
  };
}

const ORDER_SELECT = sql`
  SELECT o.*, COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', l.id, 'title', l.title, 'bin_sku', l.bin_sku, 'quantity', l.quantity, 'price', l.price,
      'image_url', l.image_url, 'registry_item_id', l.registry_item_id, 'sale_event_id', l.sale_event_id)
      ORDER BY l.created_at)
    FROM ship_order_lines l WHERE l.order_id = o.id), '[]'::jsonb) AS lines
  FROM ship_orders o`;

export const SHIP_TABS = ["to_pick", "packed", "shipped", "cancelled"] as const;
export type ShipTab = (typeof SHIP_TABS)[number];

export async function loadShipQueue(tab: ShipTab): Promise<{ orders: ShipOrder[]; counts: Record<string, number> }> {
  const recent = tab === "shipped" || tab === "cancelled" ? sql`AND o.updated_at > now() - interval '30 days'` : sql``;
  const list = await rows(sql`${ORDER_SELECT} WHERE o.status = ${tab} ${recent} ORDER BY o.sold_at DESC NULLS LAST LIMIT 500`);
  const counts = await rows(sql`
    SELECT status, count(*)::int AS n FROM ship_orders
    WHERE status IN ('to_pick', 'packed') OR updated_at > now() - interval '30 days'
    GROUP BY status`);
  return {
    orders: list.map(toOrder),
    counts: Object.fromEntries(counts.map((c) => [String(c.status), Number(c.n)])),
  };
}

export async function loadShipOrders(ids: string[]): Promise<ShipOrder[]> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500);
  if (!clean.length) return [];
  const list = await rows(sql`${ORDER_SELECT} WHERE o.id = ANY(${`{${clean.join(",")}}`}::uuid[]) ORDER BY o.sold_at DESC NULLS LAST`);
  return list.map(toOrder);
}

export const SHIP_ACTIONS = ["pick_printed", "packed", "shipped", "reopen", "cancel"] as const;
export type ShipAction = (typeof SHIP_ACTIONS)[number];

export async function applyShipAction(ids: string[], action: ShipAction, who: string): Promise<number> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500);
  if (!clean.length) return 0;
  const idList = sql`${`{${clean.join(",")}}`}::uuid[]`;
  switch (action) {
    case "pick_printed":
      return exec(sql`UPDATE ship_orders SET pick_printed_at = now(), updated_at = now(), updated_by = ${who}
        WHERE id = ANY(${idList})`);
    case "packed":
      return exec(sql`UPDATE ship_orders SET status = 'packed', packed_at = now(), updated_at = now(), updated_by = ${who}
        WHERE id = ANY(${idList}) AND status = 'to_pick'`);
    case "shipped":
      return exec(sql`UPDATE ship_orders SET status = 'shipped', shipped_at = now(), updated_at = now(), updated_by = ${who}
        WHERE id = ANY(${idList}) AND status IN ('to_pick', 'packed')`);
    case "reopen":
      return exec(sql`UPDATE ship_orders SET status = 'to_pick', packed_at = NULL, shipped_at = NULL, updated_at = now(), updated_by = ${who}
        WHERE id = ANY(${idList}) AND status <> 'to_pick'`);
    case "cancel":
      return exec(sql`UPDATE ship_orders SET status = 'cancelled', updated_at = now(), updated_by = ${who}
        WHERE id = ANY(${idList}) AND status IN ('to_pick', 'packed')`);
  }
}

/** "Mark everything sold before <date> shipped" — for the first day, when
 *  the queue starts with sales already handled through Nifty. */
export async function markShippedBefore(date: string, who: string): Promise<number> {
  if (!DATE_RE.test(date)) return 0;
  return exec(sql`
    UPDATE ship_orders SET status = 'shipped', shipped_at = now(), updated_at = now(), updated_by = ${who}, note = 'bulk: handled before FIA queue'
    WHERE status IN ('to_pick', 'packed')
      AND sold_at < ((${date}::date)::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`);
}
