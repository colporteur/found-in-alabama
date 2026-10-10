// Ask the business (Phase 5b): the read-only tools the FIA connector offers.
// Every query is a hand-written SELECT. Buyer data is limited to usernames
// and city/state (Todd, Oct 10): no real names, street addresses, emails or
// phone numbers ever leave through here.

import { db } from "@/db";
import { sql, type SQL } from "drizzle-orm";
import { argDate, argEnum, argNum, argStr, type ToolDef } from "./protocol";
import { monthReport } from "@/lib/books/books";
import { staleReport } from "@/lib/stale/report";
import { readinessReport } from "@/lib/sales/readiness";

type Row = Record<string, unknown>;
async function rows(q: SQL): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const num = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const day = (v: unknown) => iso(v)?.slice(0, 10) ?? null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VENUES = ["ebay", "mercari", "poshmark", "depop", "whatnot", "etsy", "hip", "tes", "fia"] as const;
const STATUSES = ["live", "sold", "draft", "archived", "any"] as const;

/** A US-Central calendar day → the UTC instant it starts (timestamps are stored naive UTC). */
const localStart = (d: string) => sql`((${d}::date)::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`;
const localEnd = (d: string) => sql`(((${d}::date + 1))::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`;
const local = (col: SQL) => sql`(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')`;

function todayCentral(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/** Every word must appear in the title (case-insensitive). */
function titleWords(col: SQL, q: string | null): SQL {
  if (!q) return sql`true`;
  const words = q.split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return sql`true`;
  return sql.join(
    words.map((w) => sql`${col} ILIKE ${"%" + w.replace(/[%_\\]/g, (m) => "\\" + m) + "%"}`),
    sql` AND `
  );
}

/** Sold items with their best-known sale price and store category. */
function soldBase(where: SQL): SQL {
  return sql`
    SELECT r.id, r.title, r.bin_sku, r.sold_on_venue AS venue, r.sold_at,
           ${local(sql`r.sold_at`)} AS local_at,
           COALESCE(se.price, vl.price, it.price) AS price,
           CASE WHEN se.price IS NOT NULL OR vl.price IS NOT NULL THEN 'sold' WHEN it.price IS NOT NULL THEN 'listed' END AS price_kind,
           sc.name AS category
    FROM registry_items r
    LEFT JOIN items it ON it.id = r.nifty_item_ref
    LEFT JOIN LATERAL (SELECT x.price FROM sale_events x
                       WHERE x.registry_item_id = r.id AND x.status = 'matched' AND x.price IS NOT NULL
                       ORDER BY x.sold_at DESC NULLS LAST LIMIT 1) se ON true
    LEFT JOIN LATERAL (SELECT v.price FROM venue_listings v
                       WHERE v.registry_item_id = r.id AND v.status = 'sold' AND v.venue = r.sold_on_venue AND v.price IS NOT NULL
                       LIMIT 1) vl ON true
    LEFT JOIN ebay_listings el ON el.item_id = r.primary_ebay_item_id
    LEFT JOIN ebay_store_categories sc ON sc.category_id = COALESCE(el.store_category_1_id, it.ebay_store_category_id)
    WHERE r.status = 'sold' AND r.sold_at IS NOT NULL AND ${where}`;
}

/** Live items with price, listed-since date and store category. */
function liveBase(where: SQL): SQL {
  return sql`
    SELECT r.id, r.title, r.bin_sku, r.primary_ebay_item_id,
           COALESCE(el.price, it.price) AS price,
           COALESCE(LEAST(el.start_time, it.captured_at, it.nifty_imported_at, it.created_at), r.created_at) AS listed_since,
           sc.name AS category
    FROM registry_items r
    LEFT JOIN items it ON it.id = r.nifty_item_ref
    LEFT JOIN ebay_listings el ON el.item_id = r.primary_ebay_item_id
    LEFT JOIN ebay_store_categories sc ON sc.category_id = COALESCE(el.store_category_1_id, it.ebay_store_category_id)
    WHERE r.status = 'live' AND ${where}`;
}

const binPrefix = (col: SQL) => sql`COALESCE(NULLIF(substring(${col} from '^[A-Za-z]+'), ''), CASE WHEN ${col} ~ '^\\d' THEN '(dated)' ELSE '(none)' END)`;

// ─── tools ───────────────────────────────────────────────────────────────────

const overview: ToolDef = {
  name: "business_overview",
  title: "Business overview",
  description:
    "A snapshot of the whole business right now: live inventory count and value, items sold in the last 7/30/365 days by venue, packages waiting to ship, listing drafts by status, and sales needing attention. Start here for general questions.",
  inputSchema: { type: "object", properties: {} },
  run: async () => {
    const [inv] = await rows(sql`
      SELECT (SELECT count(*)::int FROM registry_items WHERE status = 'live') AS live_items,
             (SELECT count(*)::int FROM ebay_listings WHERE quantity > 0) AS ebay_live_listings,
             (SELECT COALESCE(sum(price * quantity), 0) FROM ebay_listings WHERE quantity > 0) AS ebay_live_value,
             (SELECT count(*)::int FROM registry_items WHERE status = 'sold') AS sold_all_time,
             (SELECT count(*)::int FROM registry_items WHERE status = 'sold' AND sold_at IS NULL) AS sold_without_date,
             (SELECT count(DISTINCT bin_sku)::int FROM registry_items WHERE status = 'live' AND bin_sku IS NOT NULL) AS bins_in_use`);
    const sold = await rows(sql`
      SELECT COALESCE(sold_on_venue, '(unknown)') AS venue,
             count(*) FILTER (WHERE sold_at >= now() - interval '7 days')::int AS last_7_days,
             count(*) FILTER (WHERE sold_at >= now() - interval '30 days')::int AS last_30_days,
             count(*) FILTER (WHERE sold_at >= now() - interval '365 days')::int AS last_365_days
      FROM registry_items WHERE status = 'sold' AND sold_at IS NOT NULL
      GROUP BY 1 ORDER BY 4 DESC`);
    const listed = await rows(sql`
      SELECT venue, count(*) FILTER (WHERE status = 'live')::int AS live,
             count(*) FILTER (WHERE status = 'unknown')::int AS listed_status_unknown
      FROM venue_listings GROUP BY venue ORDER BY 2 DESC, 3 DESC`);
    const ship = await rows(sql`
      SELECT status, count(*)::int AS n FROM ship_orders WHERE status IN ('to_pick', 'packed') GROUP BY status`);
    const drafts = await rows(sql`SELECT status, count(*)::int AS n FROM listing_drafts GROUP BY status ORDER BY 2 DESC`);
    const [attn] = await rows(sql`
      SELECT count(*) FILTER (WHERE status = 'unmatched')::int AS unmatched_sales,
             count(*) FILTER (WHERE status IN ('pending', 'verifying'))::int AS sales_in_progress
      FROM sale_events`);
    return {
      asOf: new Date().toISOString(),
      inventory: { ...inv, ebay_live_value: num(inv?.ebay_live_value) },
      soldByVenue: sold,
      listingsByVenue: listed,
      listingsNote: "Mercari/Poshmark/Depop/Whatnot listings show 'unknown' until Nifty's sync confirms them; eBay and HipPostcard are exact.",
      toShip: Object.fromEntries(ship.map((r) => [r.status, r.n])),
      listingDrafts: Object.fromEntries(drafts.map((r) => [r.status, r.n])),
      attention: attn,
    };
  },
};

const GROUPS = ["venue", "month", "week", "day", "category", "bin", "bin_prefix", "price_band", "none"] as const;

const priceBand = (col: SQL) => sql`CASE WHEN ${col} IS NULL THEN '(no price)' WHEN ${col} < 5 THEN 'under $5' WHEN ${col} < 10 THEN '$5–9.99'
  WHEN ${col} < 20 THEN '$10–19.99' WHEN ${col} < 50 THEN '$20–49.99' WHEN ${col} < 100 THEN '$50–99.99' ELSE '$100+' END`;

const salesReport: ToolDef = {
  name: "sales_report",
  title: "Sales report",
  description:
    "Items sold in a date range (US Central), grouped by venue, month, week, day, eBay store category, bin, bin prefix (e.g. LT, NA) or price band — with counts, revenue and average price. Optional filters: venue, title words, bin. Set list_items to also get the individual sales (newest first, or by price). History goes back to Aug 2025. Revenue uses the sold price when known, else the listed price ('pricedFrom' says how many of each).",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD, default 30 days ago" },
      to: { type: "string", description: "YYYY-MM-DD inclusive, default today" },
      group_by: { type: "string", enum: [...GROUPS], default: "venue" },
      venue: { type: "string", enum: [...VENUES] },
      query: { type: "string", description: "Words that must all appear in the title" },
      bin: { type: "string", description: "Exact bin SKU, or a prefix ending in * (e.g. LT*)" },
      list_items: { type: "boolean", default: false },
      sort_items: { type: "string", enum: ["newest", "price"], default: "newest" },
      limit: { type: "number", default: 50, description: "Max items when list_items (≤ 200)" },
    },
  },
  run: async (a) => {
    const from = argDate(a, "from") ?? todayCentral(-30);
    const to = argDate(a, "to") ?? todayCentral();
    const group = argEnum(a, "group_by", GROUPS, "venue");
    const venue = a.venue ? argEnum(a, "venue", VENUES, "ebay") : null;
    const bin = argStr(a, "bin", 40);
    const limit = argNum(a, "limit", 50, 1, 200)!;
    const where = sql.join(
      [
        sql`r.sold_at >= ${localStart(from)} AND r.sold_at < ${localEnd(to)}`,
        venue ? sql`r.sold_on_venue = ${venue}` : sql`true`,
        titleWords(sql`r.title`, argStr(a, "query")),
        bin ? (bin.endsWith("*") ? sql`r.bin_sku ILIKE ${bin.slice(0, -1) + "%"}` : sql`r.bin_sku = ${bin}`) : sql`true`,
      ],
      sql` AND `
    );
    const key =
      group === "venue" ? sql`COALESCE(venue, '(unknown)')`
      : group === "month" ? sql`to_char(local_at, 'YYYY-MM')`
      : group === "week" ? sql`to_char(date_trunc('week', local_at), 'YYYY-MM-DD')`
      : group === "day" ? sql`to_char(local_at, 'YYYY-MM-DD')`
      : group === "category" ? sql`COALESCE(category, '(no store category)')`
      : group === "bin" ? sql`COALESCE(bin_sku, '(none)')`
      : group === "bin_prefix" ? binPrefix(sql`bin_sku`)
      : group === "price_band" ? priceBand(sql`price`)
      : sql`'all'`;
    const order = ["month", "week", "day"].includes(group) ? sql`1` : sql`2 DESC`;
    const groups = await rows(sql`
      WITH s AS (${soldBase(where)})
      SELECT ${key} AS key, count(*)::int AS sold, COALESCE(sum(price), 0) AS revenue, avg(price) AS avg_price,
             count(*) FILTER (WHERE price_kind = 'sold')::int AS priced_sold, count(*) FILTER (WHERE price_kind = 'listed')::int AS priced_listed
      FROM s GROUP BY 1 ORDER BY ${order} LIMIT 200`);
    const out: Record<string, unknown> = {
      from,
      to,
      groupBy: group,
      totals: {
        sold: groups.reduce((t, g) => t + Number(g.sold), 0),
        revenue: num(groups.reduce((t, g) => t + Number(g.revenue), 0)),
      },
      groups: groups.map((g) => ({
        key: g.key,
        sold: g.sold,
        revenue: num(g.revenue),
        avgPrice: num(g.avg_price),
        pricedFrom: { soldPrice: g.priced_sold, listedPrice: g.priced_listed },
      })),
    };
    if (a.list_items === true) {
      const items = await rows(sql`
        WITH s AS (${soldBase(where)})
        SELECT id, title, bin_sku, venue, to_char(local_at, 'YYYY-MM-DD') AS sold_on, price, price_kind, category
        FROM s ORDER BY ${argEnum(a, "sort_items", ["newest", "price"] as const, "newest") === "price" ? sql`price DESC NULLS LAST` : sql`sold_at DESC`}
        LIMIT ${limit}`);
      out.items = items.map((i) => ({ ...i, price: num(i.price) }));
    }
    return out;
  },
};

const SORTS = ["newest", "oldest", "price_desc", "price_asc", "recently_sold"] as const;

const searchInventory: ToolDef = {
  name: "search_inventory",
  title: "Search inventory",
  description:
    "Find items by title words, bin, status, venue or price. Returns id, title, bin SKU, status, price, where it's listed, when it was listed and (if sold) when/where it sold. Use item_details with an id for everything about one item.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Words that must all appear in the title" },
      status: { type: "string", enum: [...STATUSES], default: "any" },
      bin: { type: "string", description: "Exact bin SKU, or a prefix ending in *" },
      listed_on: { type: "string", enum: [...VENUES], description: "Only items with a live/unknown listing on this venue" },
      min_price: { type: "number" },
      max_price: { type: "number" },
      sort: { type: "string", enum: [...SORTS], default: "newest" },
      limit: { type: "number", default: 25, description: "≤ 100" },
    },
  },
  run: async (a) => {
    const status = argEnum(a, "status", STATUSES, "any");
    const bin = argStr(a, "bin", 40);
    const listedOn = a.listed_on ? argEnum(a, "listed_on", VENUES, "ebay") : null;
    const min = argNum(a, "min_price", null, 0, 1e6);
    const max = argNum(a, "max_price", null, 0, 1e6);
    const limit = argNum(a, "limit", 25, 1, 100)!;
    const sort = argEnum(a, "sort", SORTS, "newest");
    const price = sql`COALESCE(el.price, it.price)`;
    const where = sql.join(
      [
        status === "any" ? sql`true` : sql`r.status = ${status}`,
        titleWords(sql`r.title`, argStr(a, "query")),
        bin ? (bin.endsWith("*") ? sql`r.bin_sku ILIKE ${bin.slice(0, -1) + "%"}` : sql`r.bin_sku = ${bin}`) : sql`true`,
        listedOn ? sql`EXISTS (SELECT 1 FROM venue_listings v WHERE v.registry_item_id = r.id AND v.venue = ${listedOn} AND v.status IN ('live', 'unknown'))` : sql`true`,
        min != null ? sql`${price} >= ${min}` : sql`true`,
        max != null ? sql`${price} <= ${max}` : sql`true`,
      ],
      sql` AND `
    );
    const since = sql`COALESCE(LEAST(el.start_time, it.captured_at, it.nifty_imported_at, it.created_at), r.created_at)`;
    const order =
      sort === "oldest" ? sql`${since} ASC NULLS LAST`
      : sort === "price_desc" ? sql`${price} DESC NULLS LAST`
      : sort === "price_asc" ? sql`${price} ASC NULLS LAST`
      : sort === "recently_sold" ? sql`r.sold_at DESC NULLS LAST`
      : sql`${since} DESC NULLS LAST`;
    const [cnt] = await rows(sql`
      SELECT count(*)::int AS n FROM registry_items r
      LEFT JOIN items it ON it.id = r.nifty_item_ref LEFT JOIN ebay_listings el ON el.item_id = r.primary_ebay_item_id
      WHERE ${where}`);
    const list = await rows(sql`
      SELECT r.id, r.title, r.bin_sku, r.status, ${price} AS price, to_char(${since}, 'YYYY-MM-DD') AS listed_since,
             r.sold_on_venue, to_char(${local(sql`r.sold_at`)}, 'YYYY-MM-DD') AS sold_on, r.primary_ebay_item_id AS ebay_item_id,
             (SELECT json_agg(json_build_object('venue', v.venue, 'status', v.status) ORDER BY v.venue)
                FROM venue_listings v WHERE v.registry_item_id = r.id AND v.status IN ('live', 'unknown')) AS listed_on
      FROM registry_items r
      LEFT JOIN items it ON it.id = r.nifty_item_ref
      LEFT JOIN ebay_listings el ON el.item_id = r.primary_ebay_item_id
      WHERE ${where} ORDER BY ${order} LIMIT ${limit}`);
    return { matches: cnt?.n ?? 0, showing: list.length, items: list.map((r) => ({ ...r, price: num(r.price) })) };
  },
};

const itemDetails: ToolDef = {
  name: "item_details",
  title: "Item details",
  description:
    "Everything FIA knows about one item: registry record, eBay listing (price, quantity, store category, shipping profile, package weight, link), every venue listing, sale records, shake-up history, cost/haul, and listing drafts. Pass an id from search_inventory, or an eBay item id.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "Registry item id (uuid)" }, ebay_item_id: { type: "string" } },
  },
  run: async (a) => {
    const id = argStr(a, "id", 40);
    const ebayId = argStr(a, "ebay_item_id", 20);
    if (id && !UUID.test(id)) throw new Error("id must be a uuid from search_inventory");
    if (!id && !ebayId) throw new Error("Pass id or ebay_item_id");
    const [r] = await rows(sql`
      SELECT r.id, r.status, r.title, r.bin_sku, r.isbn, r.origin_country, r.primary_ebay_item_id, r.haul_post_slug,
             r.sold_at, r.sold_on_venue, r.created_from, r.unit_cost, a.name AS haul, a.acquired_on AS haul_date,
             it.price AS nifty_price, it.captured_at AS nifty_captured_at, it.sku AS nifty_sku, it.marketplace_urls
      FROM registry_items r
      LEFT JOIN acquisitions a ON a.id = r.acquisition_id
      LEFT JOIN items it ON it.id = r.nifty_item_ref
      WHERE ${id ? sql`r.id = ${id}::uuid` : sql`r.primary_ebay_item_id = ${ebayId} OR r.id IN (SELECT registry_item_id FROM venue_listings WHERE venue = 'ebay' AND venue_listing_id = ${ebayId})`}
      LIMIT 1`);
    if (!r) throw new Error("No such item");
    const rid = String(r.id);
    const [el] = r.primary_ebay_item_id
      ? await rows(sql`
          SELECT el.item_id, el.title, el.sku, el.price, el.quantity, el.listing_type, el.start_time, el.last_substantive_at,
                 el.site_category_name, sc1.name AS store_category, sc2.name AS store_category_2,
                 el.shipping_profile_name, el.pkg_weight_oz, el.pkg_length_in, el.pkg_width_in, el.pkg_depth_in,
                 jsonb_array_length(COALESCE(el.image_urls, '[]'::jsonb)) AS photos
          FROM ebay_listings el
          LEFT JOIN ebay_store_categories sc1 ON sc1.category_id = el.store_category_1_id
          LEFT JOIN ebay_store_categories sc2 ON sc2.category_id = el.store_category_2_id
          WHERE el.item_id = ${String(r.primary_ebay_item_id)}`)
      : [];
    const venues = await rows(sql`
      SELECT venue, status, price, url, to_char(last_seen_at, 'YYYY-MM-DD') AS last_seen FROM venue_listings
      WHERE registry_item_id = ${rid}::uuid ORDER BY venue`);
    const sales = await rows(sql`
      SELECT venue, source, status, price, to_char(${local(sql`sold_at`)}, 'YYYY-MM-DD') AS sold_on, flag, resolved_by
      FROM sale_events WHERE registry_item_id = ${rid}::uuid ORDER BY sold_at DESC NULLS LAST LIMIT 10`);
    const shakeups = await rows(sql`
      SELECT action, note, to_char(created_at, 'YYYY-MM-DD') AS on_day FROM stale_actions
      WHERE registry_item_id = ${rid}::uuid OR ebay_item_id = ${String(r.primary_ebay_item_id ?? "-")}
      ORDER BY created_at DESC LIMIT 10`);
    const enhance = await rows(sql`
      SELECT b.op, j.status, to_char(j.completed_at, 'YYYY-MM-DD') AS on_day FROM enhance_jobs j JOIN enhance_batches b ON b.id = j.batch_id
      WHERE j.ebay_item_id = ${String(r.primary_ebay_item_id ?? "-")} ORDER BY j.created_at DESC LIMIT 10`);
    const drafts = await rows(sql`
      SELECT id, status, title, price, to_char(created_at, 'YYYY-MM-DD') AS created FROM listing_drafts
      WHERE registry_item_id = ${rid}::uuid ORDER BY created_at DESC LIMIT 5`);
    return {
      item: { ...r, unit_cost: num(r.unit_cost), nifty_price: num(r.nifty_price), sold_at: iso(r.sold_at), haul_date: day(r.haul_date) },
      ebay: el ? { ...el, url: `https://www.ebay.com/itm/${el.item_id}`, price: num(el.price) } : null,
      venues: venues.map((v) => ({ ...v, price: num(v.price) })),
      sales: sales.map((s) => ({ ...s, price: num(s.price) })),
      shakeUps: shakeups,
      enhanceHistory: enhance,
      drafts: drafts.map((d) => ({ ...d, price: num(d.price), adminUrl: `https://www.foundinalabama.com/admin/listings/${d.id}` })),
    };
  },
};

const BIN_SORTS = ["live", "sold_90d", "live_value", "bin"] as const;

const bins: ToolDef = {
  name: "bins",
  title: "Bins",
  description:
    "Storage bins (the bin SKU on each item). With bin: what's in that bin — live items with prices and how much of it has sold. Without: a list of bins with live count, live value, sold in the last 90 days and all time, sortable; prefix narrows to e.g. LT or NA bins.",
  inputSchema: {
    type: "object",
    properties: {
      bin: { type: "string", description: "One exact bin SKU" },
      prefix: { type: "string", description: "Only bins starting with this, e.g. LT" },
      sort: { type: "string", enum: [...BIN_SORTS], default: "live" },
      limit: { type: "number", default: 40, description: "≤ 200" },
    },
  },
  run: async (a) => {
    const bin = argStr(a, "bin", 40);
    const limit = argNum(a, "limit", 40, 1, 200)!;
    if (bin) {
      const [sum] = await rows(sql`
        SELECT count(*) FILTER (WHERE status = 'live')::int AS live, count(*) FILTER (WHERE status = 'sold')::int AS sold,
               count(*) FILTER (WHERE status = 'sold' AND sold_at >= now() - interval '90 days')::int AS sold_90d,
               count(*) FILTER (WHERE status = 'draft')::int AS drafts
        FROM registry_items WHERE bin_sku = ${bin}`);
      const live = await rows(sql`
        SELECT id, title, price, to_char(listed_since, 'YYYY-MM-DD') AS listed_since, category
        FROM (${liveBase(sql`r.bin_sku = ${bin}`)}) x ORDER BY price DESC NULLS LAST LIMIT ${limit}`);
      const [val] = await rows(sql`SELECT COALESCE(sum(price), 0) AS v FROM (${liveBase(sql`r.bin_sku = ${bin}`)}) x`);
      return { bin, ...sum, liveValue: num(val?.v), liveItems: live.map((i) => ({ ...i, price: num(i.price) })) };
    }
    const prefix = argStr(a, "prefix", 20);
    const sort = argEnum(a, "sort", BIN_SORTS, "live");
    const order = sort === "bin" ? sql`bin` : sort === "sold_90d" ? sql`sold_90d DESC` : sort === "live_value" ? sql`live_value DESC` : sql`live DESC`;
    const list = await rows(sql`
      SELECT r.bin_sku AS bin,
             count(*) FILTER (WHERE r.status = 'live')::int AS live,
             COALESCE(sum(COALESCE(el.price, it.price)) FILTER (WHERE r.status = 'live'), 0) AS live_value,
             count(*) FILTER (WHERE r.status = 'sold' AND r.sold_at >= now() - interval '90 days')::int AS sold_90d,
             count(*) FILTER (WHERE r.status = 'sold')::int AS sold_all_time
      FROM registry_items r
      LEFT JOIN items it ON it.id = r.nifty_item_ref
      LEFT JOIN ebay_listings el ON el.item_id = r.primary_ebay_item_id
      WHERE r.bin_sku IS NOT NULL ${prefix ? sql`AND r.bin_sku ILIKE ${prefix + "%"}` : sql``}
      GROUP BY r.bin_sku ORDER BY ${order} LIMIT ${limit}`);
    const [tot] = await rows(sql`SELECT count(DISTINCT bin_sku)::int AS n FROM registry_items WHERE bin_sku IS NOT NULL ${prefix ? sql`AND bin_sku ILIKE ${prefix + "%"}` : sql``}`);
    return { bins: tot?.n ?? 0, showing: list.length, list: list.map((b) => ({ ...b, live_value: num(b.live_value) })) };
  },
};

const INV_GROUPS = ["category", "bin_prefix", "price_band", "age", "venue"] as const;

const inventoryBreakdown: ToolDef = {
  name: "inventory_breakdown",
  title: "Inventory breakdown",
  description:
    "Live inventory grouped by eBay store category, bin prefix, price band, age (time since listed) or venue — count, total and average price, and oldest listing. Good for 'what am I sitting on?' questions.",
  inputSchema: { type: "object", properties: { group_by: { type: "string", enum: [...INV_GROUPS], default: "category" } } },
  run: async (a) => {
    const g = argEnum(a, "group_by", INV_GROUPS, "category");
    if (g === "venue") {
      const list = await rows(sql`
        SELECT v.venue AS key, v.status, count(*)::int AS items, COALESCE(sum(v.price), 0) AS total, avg(v.price) AS avg_price
        FROM venue_listings v JOIN registry_items r ON r.id = v.registry_item_id AND r.status = 'live'
        WHERE v.status IN ('live', 'unknown') GROUP BY 1, 2 ORDER BY 3 DESC`);
      return { groupBy: g, groups: list.map((x) => ({ ...x, total: num(x.total), avg_price: num(x.avg_price) })) };
    }
    const key =
      g === "category" ? sql`COALESCE(category, '(no store category)')`
      : g === "bin_prefix" ? binPrefix(sql`bin_sku`)
      : g === "price_band" ? priceBand(sql`price`)
      : sql`CASE WHEN listed_since IS NULL THEN '(unknown)' WHEN listed_since > now() - interval '90 days' THEN '0–3 months'
          WHEN listed_since > now() - interval '180 days' THEN '3–6 months' WHEN listed_since > now() - interval '365 days' THEN '6–12 months'
          WHEN listed_since > now() - interval '730 days' THEN '1–2 years' ELSE '2+ years' END`;
    const list = await rows(sql`
      SELECT ${key} AS key, count(*)::int AS items, COALESCE(sum(price), 0) AS total, avg(price) AS avg_price,
             to_char(min(listed_since), 'YYYY-MM-DD') AS oldest
      FROM (${liveBase(sql`true`)}) x GROUP BY 1 ORDER BY 2 DESC LIMIT 200`);
    return {
      groupBy: g,
      note: g === "age" ? "Age is from the earliest date FIA knows (eBay start or Nifty capture), so it's 'at least'." : undefined,
      groups: list.map((x) => ({ ...x, total: num(x.total), avg_price: num(x.avg_price) })),
    };
  },
};

const profitMonth: ToolDef = {
  name: "profit_month",
  title: "Profit for a month",
  description:
    "The books for one month: revenue, estimated venue fees, postage, item cost and profit per venue and in total, from FIA's to-ship queue (which starts Oct 9 2026 — earlier months are empty). 'incomplete' counts orders missing a price or cost.",
  inputSchema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM, default this month" } } },
  run: async (a) => {
    const month = argStr(a, "month", 7) ?? todayCentral().slice(0, 7);
    const r = await monthReport(month);
    return {
      month: r.month,
      totals: r.totals,
      byVenue: r.byVenue,
      orders: r.orders.slice(0, 100).map((o) => ({
        venue: o.venue,
        soldAt: o.soldAt,
        status: o.status,
        items: o.lines.map((l) => ({ title: l.title, bin: l.binSku, qty: l.qty, price: l.price, cost: l.cost })),
        revenue: o.revenue,
        fees: o.fees,
        postage: o.shippingCost,
        itemCost: o.itemCost,
        incomplete: o.incomplete,
        profit: o.profit,
      })),
    };
  },
};

const staleSummary: ToolDef = {
  name: "stale_summary",
  title: "Shake-up (stale items)",
  description:
    "The 180-day shake-up report for live eBay items: how many are due, what each due item's next action is (rewrite, markdown, describe, bundle into a lot), and bins with enough cheap long-sitters to make a lot. Filter by action or bin.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["rewrite", "markdown", "describe", "bundle"] },
      bin: { type: "string" },
      limit: { type: "number", default: 25, description: "≤ 100" },
    },
  },
  run: async (a) => {
    const r = await staleReport({
      action: (a.action ? argEnum(a, "action", ["rewrite", "markdown", "describe", "bundle"] as const, "rewrite") : null),
      bin: argStr(a, "bin", 40),
      limit: argNum(a, "limit", 25, 1, 100)!,
    });
    return {
      cycleDays: r.settings.cycleDays,
      liveEbayItems: r.live,
      due: r.due,
      dueWithin30Days: r.dueSoon,
      byAction: r.byAction,
      items: r.items.map((i) => ({
        title: i.title,
        bin: i.sku,
        price: i.price,
        rounds: i.rounds,
        daysOverdue: i.daysOverdue,
        nextAction: i.action,
        markdownTo: i.newPrice,
        ebayItemId: i.itemId,
      })),
      lotCandidates: r.bundles.map((b) => ({ bin: b.bin, items: b.count, total: b.total })),
      adminUrl: "https://www.foundinalabama.com/admin/stale",
    };
  },
};

const buyerCity = sql`NULLIF(concat_ws(', ', o.ship_to->>'city', o.ship_to->>'state'), '')`;

const shipQueue: ToolDef = {
  name: "ship_queue",
  title: "To-ship queue",
  description:
    "Packages waiting to be picked or packed (and, optionally, recently shipped): venue, buyer username, ship-to city/state, sold date, and each item's title, bin and price.",
  inputSchema: { type: "object", properties: { include_shipped_days: { type: "number", default: 0, description: "Also show packages shipped in the last N days (≤ 30)" } } },
  run: async (a) => {
    const days = argNum(a, "include_shipped_days", 0, 0, 30)!;
    const list = await rows(sql`
      SELECT o.venue, o.status, o.buyer_username, ${buyerCity} AS ship_to,
             to_char(${local(sql`o.sold_at`)}, 'YYYY-MM-DD HH24:MI') AS sold_at, to_char(${local(sql`o.shipped_at`)}, 'YYYY-MM-DD') AS shipped_on,
             (SELECT json_agg(json_build_object('title', l.title, 'bin', l.bin_sku, 'qty', l.quantity, 'price', l.price) ORDER BY l.created_at)
                FROM ship_order_lines l WHERE l.order_id = o.id) AS items
      FROM ship_orders o
      WHERE o.status IN ('to_pick', 'packed') ${days > 0 ? sql`OR (o.status = 'shipped' AND o.shipped_at >= now() - make_interval(days => ${days}))` : sql``}
      ORDER BY CASE o.status WHEN 'to_pick' THEN 0 WHEN 'packed' THEN 1 ELSE 2 END, o.sold_at`);
    return {
      packages: list.map((o) => ({ ...o, buyer_username: o.buyer_username ?? (["tes", "fia"].includes(String(o.venue)) ? "(website customer)" : null) })),
      adminUrl: "https://www.foundinalabama.com/admin/ship",
    };
  },
};

const buyers: ToolDef = {
  name: "buyers",
  title: "Buyers",
  description:
    "Buyers by username (marketplace sales in FIA's to-ship queue since Oct 9 2026, plus HipPostcard): packages, items, spend, first/last purchase and city/state. repeat_only shows people who bought more than once. Website customers have no username and aren't listed.",
  inputSchema: {
    type: "object",
    properties: {
      username: { type: "string", description: "Part of a username" },
      repeat_only: { type: "boolean", default: false },
      limit: { type: "number", default: 25, description: "≤ 100" },
    },
  },
  run: async (a) => {
    const u = argStr(a, "username", 60);
    const limit = argNum(a, "limit", 25, 1, 100)!;
    const list = await rows(sql`
      WITH b AS (
        SELECT o.venue, lower(o.buyer_username) AS username, o.sold_at, ${buyerCity} AS place,
               COALESCE(o.order_total, (SELECT sum(l.price * l.quantity) FROM ship_order_lines l WHERE l.order_id = o.id)) AS spend,
               (SELECT COALESCE(sum(l.quantity), 0) FROM ship_order_lines l WHERE l.order_id = o.id) AS items
        FROM ship_orders o WHERE o.buyer_username IS NOT NULL AND o.status NOT IN ('cancelled', 'merged')
        UNION ALL
        SELECT 'hip', lower(h.buyer_username), h.hip_created_at, NULL, h.total, jsonb_array_length(COALESCE(h.lines, '[]'::jsonb))
        FROM hip_sales h WHERE h.buyer_username IS NOT NULL)
      SELECT venue, username, count(*)::int AS packages, sum(items)::int AS items, COALESCE(sum(spend), 0) AS spend,
             to_char(min(sold_at), 'YYYY-MM-DD') AS first, to_char(max(sold_at), 'YYYY-MM-DD') AS last,
             (array_agg(place ORDER BY sold_at DESC) FILTER (WHERE place IS NOT NULL))[1] AS city_state
      FROM b WHERE ${u ? sql`username ILIKE ${"%" + u.toLowerCase() + "%"}` : sql`true`}
      GROUP BY venue, username ${a.repeat_only === true ? sql`HAVING count(*) > 1` : sql``}
      ORDER BY packages DESC, spend DESC LIMIT ${limit}`);
    return { buyers: list.map((b) => ({ ...b, spend: num(b.spend) })) };
  },
};

const listingPipeline: ToolDef = {
  name: "listing_pipeline",
  title: "Listing pipeline",
  description:
    "New listings in progress: drafts by status (waiting for photos, ready to write, in review, approved, sent to Nifty, published), the oldest ones waiting for review, and AI spend for the last N days by app and step.",
  inputSchema: { type: "object", properties: { days: { type: "number", default: 30, description: "AI-spend window (≤ 365)" } } },
  run: async (a) => {
    const days = argNum(a, "days", 30, 1, 365)!;
    const byStatus = await rows(sql`
      SELECT status, count(*)::int AS n, to_char(min(created_at), 'YYYY-MM-DD') AS oldest FROM listing_drafts GROUP BY 1 ORDER BY 2 DESC`);
    const waiting = await rows(sql`
      SELECT id, title, bin_sku, source_label, to_char(created_at, 'YYYY-MM-DD') AS created FROM listing_drafts
      WHERE status = 'review' ORDER BY created_at LIMIT 10`);
    const [recent] = await rows(sql`
      SELECT count(*) FILTER (WHERE created_at >= now() - make_interval(days => ${days}))::int AS drafts_created,
             count(*) FILTER (WHERE nifty_sent_at >= now() - make_interval(days => ${days}))::int AS sent_to_nifty
      FROM listing_drafts`);
    const spend = await rows(sql`
      SELECT op, count(*)::int AS calls, COALESCE(sum(cost_usd), 0) AS usd
      FROM ai_call_log WHERE created_at >= now() - make_interval(days => ${days}) GROUP BY 1 ORDER BY 3 DESC`);
    return {
      byStatus,
      oldestWaitingForReview: waiting.map((w) => ({ ...w, adminUrl: `https://www.foundinalabama.com/admin/listings/${w.id}` })),
      lastNDays: { days, ...recent },
      aiSpend: spend.map((s) => ({ ...s, usd: num(s.usd) })),
      aiSpendTotal: num(spend.reduce((t, s) => t + Number(s.usd), 0)),
    };
  },
};

const hauls: ToolDef = {
  name: "hauls",
  title: "Hauls",
  description:
    "Hauls (estate sales, auctions, thrift runs…) with their cost, how many items are tied to each, how many sold, revenue from those sales and the return so far. Most older inventory isn't tied to a haul.",
  inputSchema: { type: "object", properties: { limit: { type: "number", default: 25, description: "≤ 100" } } },
  run: async (a) => {
    const limit = argNum(a, "limit", 25, 1, 100)!;
    const list = await rows(sql`
      SELECT a.id, a.name, a.kind, to_char(a.acquired_on, 'YYYY-MM-DD') AS acquired_on, a.total_cost,
             count(r.id)::int AS items, count(r.id) FILTER (WHERE r.status = 'live')::int AS live,
             count(r.id) FILTER (WHERE r.status = 'sold')::int AS sold
      FROM acquisitions a LEFT JOIN registry_items r ON r.acquisition_id = a.id
      GROUP BY a.id ORDER BY a.acquired_on DESC NULLS LAST, a.created_at DESC LIMIT ${limit}`);
    const out = [];
    for (const h of list) {
      const [rev] = await rows(sql`WITH s AS (${soldBase(sql`r.acquisition_id = ${String(h.id)}::uuid`)}) SELECT COALESCE(sum(price), 0) AS v FROM s`);
      const cost = num(h.total_cost);
      const revenue = num(rev?.v) ?? 0;
      out.push({ name: h.name, kind: h.kind, acquiredOn: h.acquired_on, cost, items: h.items, live: h.live, sold: h.sold, revenue, revenueMinusCost: cost == null ? null : num(revenue - cost) });
    }
    const [untied] = await rows(sql`SELECT count(*)::int AS n FROM registry_items WHERE acquisition_id IS NULL AND status IN ('live', 'draft')`);
    return { hauls: out, untiedLiveItems: untied?.n ?? 0, note: "Revenue here is before fees and postage." };
  },
};


const delistReadiness: ToolDef = {
  name: "delist_readiness",
  title: "Delist readiness (leaving Nifty)",
  description:
    "Per venue, how close FIA is to the Phase 7 test for leaving Nifty there: clean days in a row (of 30) where FIA saw every sale and every delist it planned was confirmed; problem days (missed or unmatched sales, delists still listed a day later) with the items involved; days not checked yet; and when the last Nifty sales check ran.",
  inputSchema: { type: "object", properties: { venue: { type: "string", enum: ["mercari", "poshmark", "depop", "whatnot", "ebay", "hip"] } } },
  run: async (a) => {
    const r = await readinessReport();
    const only = argStr(a, "venue", 20);
    return {
      today: r.today,
      lastNiftySalesCheck: r.lastCheck,
      venues: r.venues
        .filter((v) => !only || v.venue === only)
        .map((v) => ({
          venue: v.venue,
          clockStart: v.start,
          ready: v.ready,
          cleanDaysInARow: v.streak,
          cleanDays: v.clean,
          problemDays: v.problems,
          uncheckedDays: v.unchecked,
          totals: v.totals,
          verifiedBy: v.verifiedBy,
          listings: v.listings,
          problemDaysDetail: v.days.filter((d) => d.state === "problem").map((d) => ({ day: d.day, why: d.why })),
          issues: v.issues.slice(0, 30),
        })),
      adminUrl: "https://www.foundinalabama.com/admin/sales/readiness",
    };
  },
};

export const TOOLS: ToolDef[] = [
  overview,
  salesReport,
  searchInventory,
  itemDetails,
  bins,
  inventoryBreakdown,
  profitMonth,
  staleSummary,
  shipQueue,
  buyers,
  listingPipeline,
  hauls,
  delistReadiness,
];
