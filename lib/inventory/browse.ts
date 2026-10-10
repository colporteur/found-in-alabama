// Inventory browser: search, filter and edit every item in the registry —
// the FIA counterpart of Nifty's inventory page. Edits change FIA's own
// record only (title, bin, status, notes; cost/haul via the books panel).
// Each edit is logged in registry_item_edits and the field is locked against
// the hourly Nifty sync, so it isn't overwritten. When FIA takes over from
// Nifty, a pusher will send the unpushed edits to the item's live venues.

import { db } from "@/db";
import { sql, type SQL } from "drizzle-orm";

type Row = Record<string, unknown>;
async function rows(q: SQL): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const num = (v: unknown) => (v == null ? null : Number(v));
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const VENUES = ["ebay", "mercari", "poshmark", "depop", "whatnot", "hip", "etsy"] as const;
export const VENUE_NAME: Record<string, string> = {
  ebay: "eBay",
  mercari: "Mercari",
  poshmark: "Poshmark",
  depop: "Depop",
  whatnot: "Whatnot",
  hip: "HipPostcard",
  etsy: "Etsy",
  tes: "The Ephemeral State",
  fia: "Found in Alabama",
};

/** Registry statuses as the browser names them. */
export const STATUS_TABS = [
  { key: "live", label: "Active" },
  { key: "sold", label: "Sold" },
  { key: "archived", label: "Delisted" },
  { key: "draft", label: "Draft" },
  { key: "all", label: "All" },
] as const;
export type StatusKey = (typeof STATUS_TABS)[number]["key"];

export const SORTS = {
  newest: "Newest listed",
  oldest: "Oldest listed",
  price_desc: "Price: high to low",
  price_asc: "Price: low to high",
  sold_recent: "Recently sold",
  title: "Title A–Z",
} as const;
export type SortKey = keyof typeof SORTS;

export type BrowseQuery = {
  q: string | null;
  status: StatusKey;
  /** "on:ebay" listed there · "off:ebay" not listed there · "none" listed nowhere */
  venue: string | null;
  bin: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  /** Listed on or after / before (YYYY-MM-DD). */
  from: string | null;
  to: string | null;
  sort: SortKey;
  view: "table" | "grid";
  page: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseBrowseQuery(sp: Record<string, string | string[] | undefined>): BrowseQuery {
  const one = (k: string) => {
    const v = sp[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s : null;
  };
  const price = (k: string) => {
    const v = one(k);
    const n = v == null ? NaN : Number(v.replace(/[$,]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const status = (one("status") ?? "live") as StatusKey;
  const venue = one("venue");
  const sort = (one("sort") ?? "newest") as SortKey;
  const okVenue = venue && (venue === "none" || /^(on|off):(ebay|mercari|poshmark|depop|whatnot|hip|etsy)$/.test(venue));
  return {
    q: one("q")?.slice(0, 120) ?? null,
    status: STATUS_TABS.some((t) => t.key === status) ? status : "live",
    venue: okVenue ? venue : null,
    bin: one("bin")?.slice(0, 40) ?? null,
    minPrice: price("min"),
    maxPrice: price("max"),
    from: DATE.test(one("from") ?? "") ? one("from") : null,
    to: DATE.test(one("to") ?? "") ? one("to") : null,
    sort: sort in SORTS ? sort : "newest",
    view: one("view") === "grid" ? "grid" : "table",
    page: Math.max(1, Math.min(1000, Math.floor(Number(one("page")) || 1))),
  };
}

/** Back to a query string (for links that change one thing). */
export function browseHref(q: BrowseQuery, change: Partial<BrowseQuery> = {}): string {
  const m = { ...q, ...change };
  const p = new URLSearchParams();
  if (m.q) p.set("q", m.q);
  if (m.status !== "live") p.set("status", m.status);
  if (m.venue) p.set("venue", m.venue);
  if (m.bin) p.set("bin", m.bin);
  if (m.minPrice != null) p.set("min", String(m.minPrice));
  if (m.maxPrice != null) p.set("max", String(m.maxPrice));
  if (m.from) p.set("from", m.from);
  if (m.to) p.set("to", m.to);
  if (m.sort !== "newest") p.set("sort", m.sort);
  if (m.view !== "table") p.set("view", m.view);
  if (m.page > 1) p.set("page", String(m.page));
  const s = p.toString();
  return `/admin/inventory${s ? `?${s}` : ""}`;
}

const PRICE = sql`COALESCE(el.price, it.price)`;
const SINCE = sql`COALESCE(LEAST(el.start_time, it.captured_at, it.nifty_imported_at, it.created_at), r.created_at)`;
const FROM = sql`
  FROM registry_items r
  LEFT JOIN items it ON it.id = r.nifty_item_ref
  LEFT JOIN ebay_listings el ON el.item_id = r.primary_ebay_item_id`;
const localStart = (d: string) => sql`((${d}::date)::timestamp AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')`;
const listedOn = (v: string) =>
  sql`EXISTS (SELECT 1 FROM venue_listings v WHERE v.registry_item_id = r.id AND v.venue = ${v} AND v.status IN ('live', 'unknown'))`;

function filters(q: BrowseQuery, withStatus: boolean): SQL {
  const parts: SQL[] = [];
  if (withStatus && q.status !== "all") parts.push(sql`r.status = ${q.status}`);
  if (q.q) {
    const t = q.q;
    const words = t.split(/\s+/).filter(Boolean).slice(0, 8);
    const esc = (w: string) => "%" + w.replace(/[%_\\]/g, (m) => "\\" + m) + "%";
    const titleMatch = sql.join(words.map((w) => sql`r.title ILIKE ${esc(w)}`), sql` AND `);
    parts.push(sql`(${titleMatch} OR r.bin_sku ILIKE ${t} OR r.primary_ebay_item_id = ${t}
      OR EXISTS (SELECT 1 FROM venue_listings v WHERE v.registry_item_id = r.id AND v.venue_listing_id = ${t}))`);
  }
  if (q.bin) parts.push(q.bin.endsWith("*") ? sql`r.bin_sku ILIKE ${q.bin.slice(0, -1) + "%"}` : sql`r.bin_sku ILIKE ${q.bin}`);
  if (q.venue === "none") {
    parts.push(sql`NOT EXISTS (SELECT 1 FROM venue_listings v WHERE v.registry_item_id = r.id AND v.status IN ('live', 'unknown'))`);
  } else if (q.venue) {
    const [mode, v] = q.venue.split(":");
    parts.push(mode === "on" ? listedOn(v) : sql`NOT ${listedOn(v)}`);
  }
  if (q.minPrice != null) parts.push(sql`${PRICE} >= ${q.minPrice}`);
  if (q.maxPrice != null) parts.push(sql`${PRICE} <= ${q.maxPrice}`);
  if (q.from) parts.push(sql`${SINCE} >= ${localStart(q.from)}`);
  if (q.to) parts.push(sql`${SINCE} < (${localStart(q.to)} + interval '1 day')`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`true`;
}

export type BrowseItem = {
  id: string;
  title: string;
  status: string;
  binSku: string | null;
  price: number | null;
  imageUrl: string | null;
  listedSince: string | null;
  soldAt: string | null;
  soldOnVenue: string | null;
  ebayItemId: string | null;
  venues: Array<{ venue: string; status: string; url: string | null }>;
  edited: boolean;
};

export type BrowseResult = {
  query: BrowseQuery;
  pageSize: number;
  total: number;
  counts: Record<string, number>;
  items: BrowseItem[];
  editsReady: boolean;
};

export async function editsReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.registry_item_edits') IS NOT NULL AS ok`);
  return !!r?.ok;
}

export async function browseInventory(q: BrowseQuery): Promise<BrowseResult> {
  const pageSize = q.view === "grid" ? 60 : 50;
  const ready = await editsReady();
  const where = filters(q, true);
  const order =
    q.sort === "oldest" ? sql`${SINCE} ASC NULLS LAST, r.id`
    : q.sort === "price_desc" ? sql`${PRICE} DESC NULLS LAST, r.id`
    : q.sort === "price_asc" ? sql`${PRICE} ASC NULLS LAST, r.id`
    : q.sort === "sold_recent" ? sql`r.sold_at DESC NULLS LAST, r.id`
    : q.sort === "title" ? sql`r.title_normalized ASC, r.id`
    : sql`${SINCE} DESC NULLS LAST, r.id`;
  const countRows = await rows(sql`SELECT r.status, count(*)::int AS n ${FROM} WHERE ${filters(q, false)} GROUP BY r.status`);
  const counts: Record<string, number> = { all: 0 };
  for (const c of countRows) {
    counts[String(c.status)] = Number(c.n);
    counts.all += Number(c.n);
  }
  const total = q.status === "all" ? counts.all : counts[q.status] ?? 0;
  const list = await rows(sql`
    SELECT r.id, r.title, r.status, r.bin_sku, ${PRICE} AS price,
           COALESCE(el.primary_image_url, it.hero_image) AS image_url,
           ${SINCE} AS listed_since, r.sold_at, r.sold_on_venue, r.primary_ebay_item_id,
           ${ready ? sql`cardinality(r.fia_locked) > 0` : sql`false`} AS edited,
           (SELECT json_agg(json_build_object('venue', v.venue, 'status', v.status, 'url', v.url) ORDER BY v.venue)
              FROM venue_listings v WHERE v.registry_item_id = r.id AND v.status IN ('live', 'unknown', 'sold')) AS venues
    ${FROM}
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${(q.page - 1) * pageSize}`);
  return {
    query: q,
    pageSize,
    total,
    counts,
    editsReady: ready,
    items: list.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      status: String(r.status),
      binSku: (r.bin_sku as string | null) ?? null,
      price: num(r.price),
      imageUrl: (r.image_url as string | null) ?? null,
      listedSince: iso(r.listed_since),
      soldAt: iso(r.sold_at),
      soldOnVenue: (r.sold_on_venue as string | null) ?? null,
      ebayItemId: (r.primary_ebay_item_id as string | null) ?? null,
      venues: (Array.isArray(r.venues) ? r.venues : []) as BrowseItem["venues"],
      edited: !!r.edited,
    })),
  };
}

// ─── one item ────────────────────────────────────────────────────────────────

export type ItemDetail = {
  id: string;
  title: string;
  status: string;
  binSku: string | null;
  notes: string | null;
  locked: string[];
  createdFrom: string;
  createdAt: string | null;
  soldAt: string | null;
  soldOnVenue: string | null;
  niftyId: string | null;
  niftyTitle: string | null;
  niftySku: string | null;
  price: number | null;
  listedSince: string | null;
  photos: string[];
  ebay: null | {
    itemId: string;
    title: string;
    price: number | null;
    quantity: number;
    storeCategory: string | null;
    siteCategory: string | null;
    shippingProfile: string | null;
    weightOz: number | null;
    startTime: string | null;
  };
  venues: Array<{ venue: string; status: string; price: number | null; url: string | null; lastSeen: string | null }>;
  sales: Array<{ venue: string; status: string; price: number | null; soldAt: string | null; source: string }>;
  drafts: Array<{ id: string; status: string; title: string | null }>;
  edits: Array<{ field: string; oldValue: string | null; newValue: string | null; by: string | null; at: string }>;
};

export async function loadItem(id: string): Promise<ItemDetail | null> {
  if (!UUID.test(id)) return null;
  const ready = await editsReady();
  const [r] = await rows(sql`
    SELECT r.*, ${PRICE} AS price, ${SINCE} AS listed_since,
           it.nifty_id AS it_nifty_id, it.title AS nifty_title, it.sku AS nifty_sku, it.hero_image,
           el.item_id AS el_item_id, el.title AS el_title, el.price AS el_price, el.quantity AS el_qty,
           el.site_category_name, el.shipping_profile_name, el.pkg_weight_oz, el.start_time, el.image_urls,
           sc.name AS store_category
    ${FROM}
    LEFT JOIN ebay_store_categories sc ON sc.category_id = el.store_category_1_id
    WHERE r.id = ${id}::uuid`);
  if (!r) return null;
  const venues = await rows(sql`
    SELECT venue, status, price, url, last_seen_at FROM venue_listings WHERE registry_item_id = ${id}::uuid ORDER BY venue`);
  const sales = await rows(sql`
    SELECT venue, status, price, sold_at, source FROM sale_events WHERE registry_item_id = ${id}::uuid
    ORDER BY sold_at DESC NULLS LAST LIMIT 10`).catch(() => []);
  const drafts = await rows(sql`
    SELECT id, status, title FROM listing_drafts WHERE registry_item_id = ${id}::uuid ORDER BY created_at DESC LIMIT 5`).catch(() => []);
  const edits = ready
    ? await rows(sql`
        SELECT field, old_value, new_value, edited_by, edited_at FROM registry_item_edits
        WHERE registry_item_id = ${id}::uuid ORDER BY edited_at DESC LIMIT 30`)
    : [];
  const photos = Array.isArray(r.image_urls) ? (r.image_urls as string[]).filter((u) => typeof u === "string") : [];
  if (!photos.length && r.hero_image) photos.push(String(r.hero_image));
  return {
    id: String(r.id),
    title: String(r.title),
    status: String(r.status),
    binSku: (r.bin_sku as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    locked: Array.isArray(r.fia_locked) ? (r.fia_locked as string[]) : [],
    createdFrom: String(r.created_from),
    createdAt: iso(r.created_at),
    soldAt: iso(r.sold_at),
    soldOnVenue: (r.sold_on_venue as string | null) ?? null,
    niftyId: (r.it_nifty_id as string | null) ?? (r.nifty_id as string | null) ?? null,
    niftyTitle: (r.nifty_title as string | null) ?? null,
    niftySku: (r.nifty_sku as string | null) ?? null,
    price: num(r.price),
    listedSince: iso(r.listed_since),
    photos: photos.slice(0, 24),
    ebay: r.el_item_id
      ? {
          itemId: String(r.el_item_id),
          title: String(r.el_title ?? ""),
          price: num(r.el_price),
          quantity: Number(r.el_qty ?? 0),
          storeCategory: (r.store_category as string | null) ?? null,
          siteCategory: (r.site_category_name as string | null) ?? null,
          shippingProfile: (r.shipping_profile_name as string | null) ?? null,
          weightOz: num(r.pkg_weight_oz),
          startTime: iso(r.start_time),
        }
      : null,
    venues: venues.map((v) => ({ venue: String(v.venue), status: String(v.status), price: num(v.price), url: (v.url as string | null) ?? null, lastSeen: iso(v.last_seen_at) })),
    sales: sales.map((s) => ({ venue: String(s.venue), status: String(s.status), price: num(s.price), soldAt: iso(s.sold_at), source: String(s.source) })),
    drafts: drafts.map((d) => ({ id: String(d.id), status: String(d.status), title: (d.title as string | null) ?? null })),
    edits: edits.map((e) => ({ field: String(e.field), oldValue: (e.old_value as string | null) ?? null, newValue: (e.new_value as string | null) ?? null, by: (e.edited_by as string | null) ?? null, at: iso(e.edited_at) ?? "" })),
  };
}

// ─── editing ─────────────────────────────────────────────────────────────────

export const EDIT_STATUSES = ["live", "sold", "archived", "draft"] as const;

export type ItemEdit = {
  title?: string;
  binSku?: string | null;
  status?: (typeof EDIT_STATUSES)[number];
  soldOnVenue?: string | null;
  notes?: string | null;
};

/** Pure: which fields change, after cleaning the input. */
export function diffEdit(
  cur: { title: string; binSku: string | null; status: string; notes: string | null; soldOnVenue: string | null },
  e: ItemEdit
): Array<{ field: "title" | "bin_sku" | "status" | "notes" | "sold_on_venue"; from: string | null; to: string | null }> {
  const out: ReturnType<typeof diffEdit> = [];
  const clean = (v: string | null | undefined, max: number) => {
    const s = (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    return s || null;
  };
  if (e.title !== undefined) {
    const t = clean(e.title, 200);
    if (!t) throw new Error("The title can't be empty.");
    if (t !== cur.title) out.push({ field: "title", from: cur.title, to: t });
  }
  if (e.binSku !== undefined) {
    const b = clean(e.binSku, 40);
    if (b !== cur.binSku) out.push({ field: "bin_sku", from: cur.binSku, to: b });
  }
  if (e.status !== undefined) {
    if (!EDIT_STATUSES.includes(e.status)) throw new Error("Unknown status");
    if (e.status !== cur.status) out.push({ field: "status", from: cur.status, to: e.status });
  }
  const finalStatus = e.status ?? cur.status;
  if (finalStatus === "sold" && e.soldOnVenue !== undefined) {
    const v = clean(e.soldOnVenue, 20)?.toLowerCase() ?? null;
    if (v && !(v in VENUE_NAME)) throw new Error("Unknown venue");
    if (v !== cur.soldOnVenue) out.push({ field: "sold_on_venue", from: cur.soldOnVenue, to: v });
  }
  if (e.notes !== undefined) {
    const n = (e.notes ?? "").trim().slice(0, 4000) || null;
    if (n !== cur.notes) out.push({ field: "notes", from: cur.notes, to: n });
  }
  return out;
}

export async function updateItem(id: string, e: ItemEdit, who: string): Promise<{ changed: string[] }> {
  if (!(await editsReady())) throw new Error("Run npm run db:migrate first (migration 0041).");
  const item = await loadItem(id);
  if (!item) throw new Error("No such item");
  const changes = diffEdit(item, e);
  if (!changes.length) return { changed: [] };
  for (const c of changes) {
    const lock = ["title", "bin_sku", "status"].includes(c.field) ? c.field : null;
    const set =
      c.field === "title"
        ? sql`title = ${c.to}, title_normalized = lower(trim(${c.to}))`
        : c.field === "bin_sku"
          ? sql`bin_sku = ${c.to}`
          : c.field === "notes"
            ? sql`notes = ${c.to}`
            : c.field === "sold_on_venue"
              ? sql`sold_on_venue = ${c.to}`
              : c.to === "sold"
                ? sql`status = 'sold', sold_at = COALESCE(sold_at, now())`
                : sql`status = ${c.to}, sold_at = NULL, sold_on_venue = NULL`;
    await db.execute(sql`
      UPDATE registry_items SET ${set}, updated_at = now()
        ${lock ? sql`, fia_locked = CASE WHEN ${lock}::text = ANY(fia_locked) THEN fia_locked ELSE array_append(fia_locked, ${lock}::text) END` : sql``}
      WHERE id = ${id}::uuid`);
    await db.execute(sql`
      INSERT INTO registry_item_edits (registry_item_id, field, old_value, new_value, edited_by)
      VALUES (${id}::uuid, ${c.field}, ${c.from}, ${c.to}, ${who})`);
  }
  return { changed: changes.map((c) => c.field) };
}

/** Give a field back to the Nifty sync (it'll take Nifty's value next run). */
export async function unlockField(id: string, field: string, who: string): Promise<void> {
  if (!["title", "bin_sku", "status"].includes(field)) throw new Error("Unknown field");
  await db.execute(sql`UPDATE registry_items SET fia_locked = array_remove(fia_locked, ${field}::text), updated_at = now() WHERE id = ${id}::uuid`);
  await db.execute(sql`
    INSERT INTO registry_item_edits (registry_item_id, field, old_value, new_value, edited_by)
    VALUES (${id}::uuid, ${field}, 'FIA', 'back to Nifty', ${who})`);
}
