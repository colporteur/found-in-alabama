// The to-ship queue (Phase 4a). Built from sale_events, so every venue's
// sales land in one list; ship_orders holds what's been picked, packed and
// shipped (this replaces the Nifty Pick List's local "already included"
// history). Writes ONLY ship_orders / ship_order_lines / app_settings
// "fulfillment" — nothing is sent to any marketplace.
//
// Grouping: a website order (Stripe), a Hip sale or one sale email (a
// Poshmark/Depop bundle) is one package with all its lines. eBay orders come
// from the Fulfillment API (4b) once eBay order access is granted: eBay's own
// combined orders become one package, with buyer, ship-to, totals and fees,
// and turn shipped / cancelled from eBay's status. Poshmark and Depop buyers
// come from the sale emails, so two sales to one buyer are flagged for
// combining.
//
// syncShipQueue() is idempotent; it runs on page load and after each
// sales-sync.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { fetchEbayOrdersSince, type EbayOrder } from "@/lib/ebay/orders";
import { parseEmailBuyer } from "./buyers";

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
    WHEN e.source = 'email' THEN 'email:' || e.source_ref
    ELSE 'sale:' || e.id::text END`);

export type SyncResult = {
  ready: boolean;
  orders: number;
  lines: number;
  refreshed: number;
  dropped: number;
  shipped: number;
  /** eBay orders read (null = eBay order access not granted yet). */
  ebayOrders?: number | null;
  ebayError?: string;
  buyers?: number;
};

export async function syncShipQueue(): Promise<SyncResult> {
  const none = { orders: 0, lines: 0, refreshed: 0, dropped: 0, shipped: 0 };
  let ebayOrders: number | null = null;
  let ebayError: string | undefined;
  if (!(await shipTablesReady())) return { ready: false, ...none };
  const { startDate } = await fulfillmentSettings();
  if (!startDate) return { ready: false, ...none };
  const since = sql`((${startDate}::date)::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`;

  // 0. eBay orders (when access is granted), then tie eBay sale events to them
  try {
    ebayOrders = await syncEbayOrders(startDate);
  } catch (err) {
    ebayError = (err as Error).message;
    console.error("[ship] eBay orders failed", err);
  }
  await claimEbayEvents();
  // With eBay order access, eBay packages come only from eBay orders (sale
  // events just attach to them): a sell-out without an order isn't a sale.
  const ebayFromOrders = ebayOrders !== null && !ebayError;
  const venueFilter = ebayFromOrders ? sql`AND e.venue <> 'ebay'` : sql``;

  // 1. one package per order key
  const orders = await exec(sql`
    INSERT INTO ship_orders (venue, order_key, venue_order_id, buyer_name, sold_at, order_total, shipping_paid)
    SELECT k.venue, k.order_key, min(k.venue_order_id), min(t.shipping_name), min(k.sold_at),
           min(t.total), min(t.shipping)
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
        AND NOT EXISTS (SELECT 1 FROM ship_order_lines x WHERE x.sale_event_id = e.id)
        ${venueFilter}
    ) k
    LEFT JOIN tes_orders t ON t.id::text = k.tes_order_id
    GROUP BY k.venue, k.order_key
    ON CONFLICT (venue, order_key) DO NOTHING`);

  // 1b. website order totals for packages made before totals were kept
  await exec(sql`
    UPDATE ship_orders o SET order_total = t.total, shipping_paid = t.shipping
    FROM tes_orders t
    WHERE o.order_key = 'stripe:' || t.id::text AND o.order_total IS NULL`);

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
      ${venueFilter}
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
    WHERE l.sale_event_id = e.id AND e.registry_item_id IS NOT NULL
      AND l.registry_item_id IS DISTINCT FROM e.registry_item_id`);

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

  const buyers = await captureEmailBuyers();

  return { ready: true, orders, lines, refreshed, dropped, shipped, ebayOrders, ebayError, buyers };
}

// ─── eBay orders (4b) ────────────────────────────────────────────────────────

/** How far back eBay orders are re-read each sync (status changes). */
const EBAY_ORDER_DAYS = 21;

async function syncEbayOrders(startDate: string): Promise<number | null> {
  const start = new Date(`${startDate}T05:00:00Z`).getTime(); // midnight Central (CDT)
  const sinceMs = Math.max(start, Date.now() - EBAY_ORDER_DAYS * 86_400_000);
  const orders = await fetchEbayOrdersSince(new Date(sinceMs).toISOString());
  if (orders === null) return null;
  for (const o of orders) await upsertEbayOrder(o);
  return orders.length;
}

async function upsertEbayOrder(o: EbayOrder): Promise<void> {
  const [row] = await rows(sql`
    INSERT INTO ship_orders (venue, order_key, venue_order_id, buyer_name, buyer_username, ship_to, sold_at,
                             order_total, shipping_paid, venue_fees)
    VALUES ('ebay', ${`ebay:${o.orderId}`}, ${o.orderId}, ${o.buyerName}, ${o.buyerUsername},
            ${o.shipTo ? JSON.stringify(o.shipTo) : null}::jsonb, ${o.createdAt}::timestamptz,
            ${o.total}::numeric, ${o.shipping}::numeric, ${o.fees}::numeric)
    ON CONFLICT (venue, order_key) DO UPDATE SET
      buyer_name = COALESCE(EXCLUDED.buyer_name, ship_orders.buyer_name),
      buyer_username = COALESCE(EXCLUDED.buyer_username, ship_orders.buyer_username),
      ship_to = COALESCE(EXCLUDED.ship_to, ship_orders.ship_to),
      order_total = COALESCE(EXCLUDED.order_total, ship_orders.order_total),
      shipping_paid = COALESCE(EXCLUDED.shipping_paid, ship_orders.shipping_paid),
      venue_fees = COALESCE(EXCLUDED.venue_fees, ship_orders.venue_fees)
    RETURNING id, status`);
  if (!row) return;
  const orderId = String(row.id);

  // eBay's status wins for shipped / cancelled.
  if (o.cancelled) {
    await exec(sql`UPDATE ship_orders SET status = 'cancelled', updated_at = now(), updated_by = 'ebay'
      WHERE id = ${orderId}::uuid AND status IN ('to_pick', 'packed')`);
  } else if (o.fulfillmentStatus === "FULFILLED") {
    await exec(sql`UPDATE ship_orders SET status = 'shipped', shipped_at = COALESCE(shipped_at, now()), updated_at = now(), updated_by = 'ebay'
      WHERE id = ${orderId}::uuid AND status IN ('to_pick', 'packed')`);
  }

  for (const l of o.lines) {
    if (!l.legacyItemId) continue;
    const [have] = await rows(sql`SELECT 1 AS ok FROM ship_order_lines WHERE order_id = ${orderId}::uuid AND venue_line_id = ${l.lineItemId}`);
    if (have) continue;
    const unit = l.lineCost != null ? Math.round((l.lineCost / l.quantity) * 100) / 100 : null;

    // A package already made from this item's eBay sale event → move its line here.
    const [src] = await rows(sql`
      SELECT x2.id, x2.order_id, so.status AS src_status FROM ship_order_lines x2
      JOIN ship_orders so ON so.id = x2.order_id
      LEFT JOIN sale_events e ON e.id = x2.sale_event_id
      WHERE so.venue = 'ebay' AND so.order_key LIKE 'sale:%' AND so.status IN ('to_pick', 'packed')
        AND COALESCE(x2.ebay_item_id, e.ebay_item_id) = ${l.legacyItemId}
        AND so.sold_at BETWEEN ${o.createdAt}::timestamptz - interval '3 days' AND ${o.createdAt}::timestamptz + interval '3 days'
      ORDER BY so.sold_at LIMIT 1`);
    const moved = src
      ? await exec(sql`
          UPDATE ship_order_lines x
          SET order_id = ${orderId}::uuid, venue_line_id = ${l.lineItemId}, ebay_item_id = ${l.legacyItemId},
              quantity = ${l.quantity}, price = COALESCE(${unit}::numeric, x.price)
          WHERE x.id = ${String(src.id)}::uuid`)
      : 0;
    if (moved) {
      // The package it came from now lives inside this order.
      await exec(sql`
        UPDATE ship_orders o SET status = 'merged', merged_into = ${orderId}::uuid, updated_at = now(), updated_by = 'ebay'
        WHERE o.id = ${String(src.order_id)}::uuid
          AND NOT EXISTS (SELECT 1 FROM ship_order_lines l WHERE l.order_id = o.id)`);
      // Already packed by hand → the eBay order stays packed.
      if (src.src_status === "packed") {
        await exec(sql`UPDATE ship_orders SET status = 'packed', packed_at = COALESCE(packed_at, now())
          WHERE id = ${orderId}::uuid AND status = 'to_pick'`);
      }
      continue;
    }

    await exec(sql`
      INSERT INTO ship_order_lines (order_id, registry_item_id, ebay_item_id, venue_line_id, title, bin_sku, quantity, price, image_url)
      SELECT ${orderId}::uuid, r.id, ${l.legacyItemId}, ${l.lineItemId}, COALESCE(r.title, ${l.title}),
             COALESCE(r.bin_sku, ${l.sku}), ${l.quantity}, ${unit}::numeric,
             COALESCE(it.hero_image, el.primary_image_url)
      FROM (SELECT 1) one
      LEFT JOIN registry_items r ON r.primary_ebay_item_id = ${l.legacyItemId}
      LEFT JOIN items it ON it.nifty_id = r.nifty_id
      LEFT JOIN ebay_listings el ON el.item_id = ${l.legacyItemId}
      LIMIT 1`);
  }
}

/** eBay sale events seen AFTER their eBay order: attach them to its line
 *  instead of making a second package. */
async function claimEbayEvents(): Promise<void> {
  const pairs = await rows(sql`
    SELECT DISTINCT ON (l.id) l.id AS line_id, e.id AS event_id
    FROM ship_order_lines l
    JOIN ship_orders o ON o.id = l.order_id AND o.order_key LIKE 'ebay:%'
    JOIN sale_events e ON e.venue = 'ebay' AND e.ebay_item_id = l.ebay_item_id
      AND e.status NOT IN ('duplicate', 'ignored')
      AND COALESCE(e.sold_at, e.detected_at) BETWEEN o.sold_at - interval '3 days' AND o.sold_at + interval '3 days'
    WHERE l.sale_event_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM ship_order_lines x WHERE x.sale_event_id = e.id)
    ORDER BY l.id, e.detected_at`);
  for (const p of pairs) {
    await exec(sql`
      UPDATE ship_order_lines l
      SET sale_event_id = ${String(p.event_id)}::uuid,
          registry_item_id = COALESCE(l.registry_item_id, (SELECT registry_item_id FROM sale_events WHERE id = ${String(p.event_id)}::uuid))
      WHERE l.id = ${String(p.line_id)}::uuid AND l.sale_event_id IS NULL`).catch(() => 0);
  }
}

// ─── Poshmark / Depop buyers from the sale emails (4b) ───────────────────────

async function captureEmailBuyers(): Promise<number> {
  const list = await rows(sql`
    SELECT DISTINCT ON (o.id) o.id, o.venue, m.subject, m.html_body, m.text_body
    FROM ship_orders o
    JOIN ship_order_lines l ON l.order_id = o.id
    JOIN sale_events e ON e.id = l.sale_event_id AND e.source = 'email'
    JOIN email_messages m ON m.id::text = e.source_ref
    WHERE o.venue IN ('poshmark', 'depop') AND o.buyer_username IS NULL
      AND o.status IN ('to_pick', 'packed')
    ORDER BY o.id
    LIMIT 40`);
  let n = 0;
  for (const r of list) {
    const b = parseEmailBuyer(String(r.venue), (r.subject as string) ?? null, (r.html_body as string) ?? null, (r.text_body as string) ?? null);
    if (!b.username && !b.name) continue;
    n += await exec(sql`
      UPDATE ship_orders SET buyer_username = ${b.username}, buyer_name = COALESCE(buyer_name, ${b.name}),
        ship_to = COALESCE(ship_to, ${b.shipToText ? JSON.stringify({ text: b.shipToText }) : null}::jsonb)
      WHERE id = ${String(r.id)}::uuid`);
  }
  return n;
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
  buyerUsername: string | null;
  soldAt: string | null;
  status: string;
  orderTotal: number | null;
  shippingPaid: number | null;
  pickPrintedAt: string | null;
  invoicePrintedAt: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  trackingNumber: string | null;
  lines: ShipLine[];
  /** Other open packages on the same venue to the same buyer (combine?). */
  sameBuyer: string[];
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
    buyerUsername: (r.buyer_username as string | null) ?? null,
    soldAt: iso(r.sold_at),
    status: String(r.status),
    orderTotal: r.order_total == null ? null : Number(r.order_total),
    shippingPaid: r.shipping_paid == null ? null : Number(r.shipping_paid),
    pickPrintedAt: iso(r.pick_printed_at),
    invoicePrintedAt: iso(r.invoice_printed_at),
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
    sameBuyer: [],
  };
}

/** Open marketplace packages to the same buyer on the same venue, sold
 *  within a week of each other. eBay is skipped: eBay combines its own. */
export function markSameBuyer(orders: ShipOrder[]): ShipOrder[] {
  const open = orders.filter((o) => (o.status === "to_pick" || o.status === "packed") && o.buyerUsername && o.venue !== "ebay");
  const by = new Map<string, ShipOrder[]>();
  for (const o of open) {
    const k = `${o.venue}|${o.buyerUsername!.toLowerCase()}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(o);
  }
  const t = (o: ShipOrder) => (o.soldAt ? new Date(o.soldAt).getTime() : 0);
  for (const group of Array.from(by.values())) {
    if (group.length < 2) continue;
    for (const o of group) {
      o.sameBuyer = group.filter((x) => x.id !== o.id && Math.abs(t(x) - t(o)) <= 7 * 86_400_000).map((x) => x.id);
    }
  }
  return orders;
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
    orders: markSameBuyer(list.map(toOrder)),
    counts: Object.fromEntries(counts.map((c) => [String(c.status), Number(c.n)])),
  };
}

export async function loadShipOrders(ids: string[]): Promise<ShipOrder[]> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500);
  if (!clean.length) return [];
  const list = await rows(sql`${ORDER_SELECT} WHERE o.id = ANY(${`{${clean.join(",")}}`}::uuid[]) ORDER BY o.sold_at DESC NULLS LAST`);
  return list.map(toOrder);
}

export const SHIP_ACTIONS = ["pick_printed", "invoice_printed", "packed", "shipped", "reopen", "cancel", "combine"] as const;
export type ShipAction = (typeof SHIP_ACTIONS)[number];

export async function applyShipAction(ids: string[], action: ShipAction, who: string): Promise<number> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500);
  if (!clean.length) return 0;
  const idList = sql`${`{${clean.join(",")}}`}::uuid[]`;
  switch (action) {
    case "pick_printed":
      return exec(sql`UPDATE ship_orders SET pick_printed_at = now(), updated_at = now(), updated_by = ${who}
        WHERE id = ANY(${idList})`);
    case "invoice_printed":
      return exec(sql`UPDATE ship_orders SET invoice_printed_at = now(), updated_at = now(), updated_by = ${who}
        WHERE id = ANY(${idList})`);
    case "combine":
      return combineOrders(clean, who);
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

/** One package from several: lines move to the earliest sale, the rest
 *  become "merged". Only open packages on one venue. Returns how many were
 *  folded in (0 when the selection can't be combined). */
async function combineOrders(ids: string[], who: string): Promise<number> {
  if (ids.length < 2) throw new Error("Pick at least two packages to combine.");
  const list = await rows(sql`
    SELECT id, venue, status, buyer_name, buyer_username, ship_to FROM ship_orders
    WHERE id = ANY(${`{${ids.join(",")}}`}::uuid[]) ORDER BY sold_at NULLS LAST, created_at`);
  if (list.length !== ids.length) throw new Error("Some packages weren't found.");
  if (new Set(list.map((r) => r.venue)).size > 1) throw new Error("Only packages from the same venue can be combined.");
  if (list.some((r) => r.status !== "to_pick" && r.status !== "packed")) throw new Error("Only packages still to pick or packed can be combined.");
  const [target, ...rest] = list;
  const restIds = sql`${`{${rest.map((r) => String(r.id)).join(",")}}`}::uuid[]`;
  await exec(sql`UPDATE ship_order_lines SET order_id = ${String(target.id)}::uuid WHERE order_id = ANY(${restIds})`);
  await exec(sql`
    UPDATE ship_orders t SET
      buyer_name = COALESCE(t.buyer_name, (SELECT max(buyer_name) FROM ship_orders WHERE id = ANY(${restIds}))),
      buyer_username = COALESCE(t.buyer_username, (SELECT max(buyer_username) FROM ship_orders WHERE id = ANY(${restIds}))),
      status = 'to_pick', packed_at = NULL, updated_at = now(), updated_by = ${who}
    WHERE t.id = ${String(target.id)}::uuid`);
  return exec(sql`
    UPDATE ship_orders SET status = 'merged', merged_into = ${String(target.id)}::uuid, updated_at = now(), updated_by = ${who}
    WHERE id = ANY(${restIds})`);
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
