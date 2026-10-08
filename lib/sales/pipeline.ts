// Sale detection pipeline (Phase SALES-1, SHADOW MODE).
//
//   1. ingest   — turn every sale signal into a sale_events row:
//                   eBay       GetSellerEvents hook (lib/ebay/events-sync.ts)
//                   Hip        hip_sales (Hip poller)
//                   TES / FIA  paid Stripe orders (tes_orders)
//                   email      Mercari / Poshmark / Depop / Whatnot sale mails
//                              and Nifty failure notices, forwarded to the
//                              site inbox (email_messages)
//   2. match    — tie each sale to a registry item (exact id → eBay id →
//                 title → title prefix; ties go to review)
//   3. plan     — record which OTHER listings should come down (delist_plans)
//                 and mark the registry item sold
//   4. outcome  — watch whether they did come down (eBay mirror, Hip map,
//                 Nifty capture status, Nifty failure mails)
//
// Writes ONLY sale_events, delist_plans, sale_email_scans, nifty_alerts and
// the registry's sold state. Nothing is sent to eBay, Hip, Nifty or any
// marketplace — Nifty keeps doing every delist while this scores it.
//
// Every step is idempotent; the 5-minute cron (/api/cron/sales-sync) and the
// "Run now" button just call runSalesSync() again.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { parseSaleEmail, normalizeTitle, type ParsedSaleLine } from "./parse";
import { pickCandidate, likePrefix, type Candidate } from "./match";

type Row = Record<string, unknown>;

async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

async function exec(q: ReturnType<typeof sql>): Promise<number> {
  const res = (await db.execute(q)) as { rowCount?: number | null };
  return res.rowCount ?? 0;
}

/** Sales older than this when first matched are history: the registry is
 *  updated, but no delist plan is written (their legs came down long ago). */
const PLAN_WINDOW_DAYS = 3;
/** How far back the Hip / Stripe ingesters look. */
const INGEST_LOOKBACK_DAYS = 45;
/** Outcomes are re-checked for this long after planning. */
const OUTCOME_WINDOW_DAYS = 30;
/** Shortest Depop title prefix trusted for a prefix match. */
const MIN_PREFIX_CHARS = 15;

/** Senders the email ingester reads (all forwarded to the site inbox). */
export const SALE_EMAIL_SENDER_PATTERNS = [
  "%@alerts.us.mercari.com",
  "orders@poshmark.com",
  "%@alerts.depop.com",
  "orders@whatnot.com",
  "%@nifty.ai",
];

export async function salesTablesReady(): Promise<boolean> {
  const [r] = await rows(
    sql`SELECT to_regclass('public.sale_events') IS NOT NULL AS ok`,
  );
  return !!r?.ok;
}

// ─── 1. ingest ────────────────────────────────────────────────────────────────

export type EbaySaleSignal = {
  itemId: string;
  title: string | null;
  price: string | null;
  quantitySold: number;
};

/**
 * Called by the eBay events sync for listings whose available quantity just
 * hit 0 with QuantitySold > 0 (a sale, not a manual end). Never throws — the
 * events sync must not fail because of this.
 */
export async function recordEbaySales(
  signals: EbaySaleSignal[],
): Promise<{ ok: boolean; inserted: number; error?: string }> {
  if (signals.length === 0) return { ok: true, inserted: 0 };
  try {
    if (!(await salesTablesReady())) return { ok: true, inserted: 0 };
    let inserted = 0;
    for (const s of signals) {
      inserted += await exec(sql`
        INSERT INTO sale_events (source, source_ref, line, venue, venue_listing_id, ebay_item_id,
                                 title, price, sold_at, note)
        VALUES ('ebay_events', ${s.itemId}, 0, 'ebay', ${s.itemId}, ${s.itemId},
                COALESCE(${s.title}, (SELECT title FROM ebay_listings WHERE item_id = ${s.itemId})),
                ${s.price}::numeric, now(), ${`quantity sold ${s.quantitySold}`})
        ON CONFLICT DO NOTHING`);
    }
    return { ok: true, inserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[sales] eBay sale hook skipped: ${message}`);
    return { ok: false, inserted: 0, error: message };
  }
}

export async function ingestHip(): Promise<number> {
  return exec(sql`
    INSERT INTO sale_events (source, source_ref, line, venue, venue_listing_id, ebay_item_id,
                             title, price, sold_at)
    SELECT 'hip', h.hip_sale_id::text, (l.ord - 1)::int, 'hip',
           NULLIF(l.v->>'hipListingId', ''), NULLIF(l.v->>'itemId', ''),
           l.v->>'title', NULLIF(l.v->>'price', '')::numeric,
           COALESCE(h.hip_created_at, h.created_at)
    FROM hip_sales h
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(h.lines) = 'array' THEN h.lines ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS l(v, ord)
    WHERE h.created_at > now() - make_interval(days => ${INGEST_LOOKBACK_DAYS})
    ON CONFLICT DO NOTHING`);
}

export async function ingestStripe(): Promise<number> {
  // TES and FIA checkouts. Hip orders also live in tes_orders (source 'hip')
  // but come in through hip_sales above.
  return exec(sql`
    INSERT INTO sale_events (source, source_ref, line, venue, ebay_item_id, title, price, order_ref, sold_at)
    SELECT 'stripe', i.id::text, 0, o.source, i.item_id, i.title, i.unit_price, o.id::text,
           COALESCE(o.paid_at, o.created_at)
    FROM tes_order_items i JOIN tes_orders o ON o.id = i.order_id
    WHERE o.status = 'paid' AND o.source IN ('tes', 'fia')
      AND o.created_at > now() - make_interval(days => ${INGEST_LOOKBACK_DAYS})
    ON CONFLICT DO NOTHING`);
}

export type EmailIngestResult = {
  scanned: number;
  sales: number;
  alerts: number;
  ignored: number;
  errors: number;
};

export async function ingestEmails(limit = 200): Promise<EmailIngestResult> {
  const senders = sql.join(
    SALE_EMAIL_SENDER_PATTERNS.map((p) => sql`lower(m.from_address) LIKE ${p}`),
    sql` OR `,
  );
  const msgs = await rows(sql`
    SELECT m.id, m.from_address, m.subject, m.text_body, m.html_body,
           COALESCE(m.sent_at, m.received_at) AS at
    FROM email_messages m
    WHERE (${senders})
      AND NOT EXISTS (SELECT 1 FROM sale_email_scans s WHERE s.message_id = m.id)
    ORDER BY m.received_at
    LIMIT ${limit}`);

  const out: EmailIngestResult = {
    scanned: 0,
    sales: 0,
    alerts: 0,
    ignored: 0,
    errors: 0,
  };
  for (const m of msgs) {
    out.scanned++;
    const id = String(m.id);
    const at = m.at ? new Date(String(m.at)) : new Date();
    let result = "ignored";
    let detail: string | null = null;
    try {
      const parsed = parseSaleEmail({
        from: (m.from_address as string | null) ?? null,
        subject: (m.subject as string | null) ?? null,
        text: (m.text_body as string | null) ?? null,
        html: (m.html_body as string | null) ?? null,
      });
      if (parsed?.kind === "sale") {
        result = "sale";
        const lines: (ParsedSaleLine | null)[] =
          parsed.lines.length > 0 ? parsed.lines : [null];
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          await exec(sql`
            INSERT INTO sale_events (source, source_ref, line, venue, venue_listing_id, title,
                                     title_truncated, price, order_ref, sold_at, status, note)
            VALUES ('email', ${id}, ${i}, ${parsed.venue}, ${l?.venueListingId ?? null},
                    ${l?.title ?? (m.subject as string | null)}, ${l?.titleTruncated ?? false},
                    ${l?.price ?? null}::numeric, ${parsed.orderRef}, ${at.toISOString()}::timestamptz,
                    ${l ? "pending" : "unmatched"},
                    ${l ? null : "Sale email recognised, but its item lines couldn't be read"})
            ON CONFLICT DO NOTHING`);
        }
        out.sales++;
        detail = `${parsed.venue} ×${parsed.lines.length}`;
      } else if (parsed) {
        result = "nifty_alert";
        const title = "title" in parsed ? parsed.title : null;
        await exec(sql`
          INSERT INTO nifty_alerts (message_id, kind, title, title_normalized, sold_venue, failed, venue, received_at)
          VALUES (${id}, ${parsed.kind}, ${title}, ${title ? normalizeTitle(title) : null},
                  ${"soldVenue" in parsed ? parsed.soldVenue : null},
                  ${JSON.stringify("failed" in parsed ? parsed.failed : [])}::jsonb,
                  ${"venue" in parsed ? parsed.venue : null}, ${at.toISOString()}::timestamptz)
          ON CONFLICT (message_id) DO NOTHING`);
        out.alerts++;
        detail = parsed.kind;
      } else {
        out.ignored++;
      }
    } catch (err) {
      result = "error";
      detail = err instanceof Error ? err.message : String(err);
      out.errors++;
    }
    await exec(sql`
      INSERT INTO sale_email_scans (message_id, result, detail) VALUES (${id}, ${result}, ${detail})
      ON CONFLICT (message_id) DO NOTHING`);
  }
  return out;
}

// ─── 2. match ─────────────────────────────────────────────────────────────────

type MatchResult = {
  status: "matched" | "ambiguous" | "unmatched";
  registryItemId: string | null;
  method: string | null;
  candidates: string[] | null;
  note: string | null;
};

async function findByVenueId(
  venue: string,
  id: string,
): Promise<string | null> {
  const [r] = await rows(sql`
    SELECT registry_item_id FROM venue_listings WHERE venue = ${venue} AND venue_listing_id = ${id} LIMIT 1`);
  return r ? String(r.registry_item_id) : null;
}

async function findByEbayId(id: string): Promise<string | null> {
  const viaListing = await findByVenueId("ebay", id);
  if (viaListing) return viaListing;
  const [r] = await rows(
    sql`SELECT id FROM registry_items WHERE primary_ebay_item_id = ${id} LIMIT 1`,
  );
  return r ? String(r.id) : null;
}

async function titleCandidates(
  venue: string,
  title: string,
  prefix: boolean,
): Promise<Candidate[]> {
  const t = normalizeTitle(title);
  const cond = prefix
    ? sql`r.title_normalized LIKE ${likePrefix(t)}`
    : sql`r.title_normalized = ${t}`;
  const found = await rows(sql`
    SELECT r.id, r.status, v.status AS venue_status, i.price AS nifty_price, e.price AS ebay_price
    FROM registry_items r
    LEFT JOIN venue_listings v ON v.registry_item_id = r.id AND v.venue = ${venue}
    LEFT JOIN items i ON i.id = r.nifty_item_ref
    LEFT JOIN ebay_listings e ON e.item_id = r.primary_ebay_item_id
    WHERE ${cond}
    LIMIT 50`);
  return found.map((f) => ({
    registryItemId: String(f.id),
    itemStatus: String(f.status),
    venueStatus: f.venue_status == null ? null : String(f.venue_status),
    prices: [f.nifty_price, f.ebay_price].filter((p) => p != null).map(Number),
  }));
}

async function matchOne(e: Row): Promise<MatchResult> {
  const venue = String(e.venue);
  const venueListingId = e.venue_listing_id ? String(e.venue_listing_id) : null;
  const ebayItemId = e.ebay_item_id ? String(e.ebay_item_id) : null;

  if (venueListingId && venue !== "tes" && venue !== "fia") {
    const id = await findByVenueId(venue, venueListingId);
    if (id)
      return {
        status: "matched",
        registryItemId: id,
        method: "exact_id",
        candidates: null,
        note: null,
      };
  }
  if (ebayItemId) {
    const id = await findByEbayId(ebayItemId);
    if (id)
      return {
        status: "matched",
        registryItemId: id,
        method: "ebay_id",
        candidates: null,
        note: null,
      };
  }

  const title = e.title ? String(e.title) : "";
  if (!title.trim()) {
    return {
      status: "unmatched",
      registryItemId: null,
      method: null,
      candidates: null,
      note: "No id or title to match on",
    };
  }
  const prefix = e.title_truncated === true;
  if (prefix && normalizeTitle(title).length < MIN_PREFIX_CHARS) {
    return {
      status: "unmatched",
      registryItemId: null,
      method: null,
      candidates: null,
      note: "Shortened title too short to match safely",
    };
  }
  const price = e.price == null ? null : Number(e.price);
  const decision = pickCandidate(
    await titleCandidates(venue, title, prefix),
    price,
    { historical: e.historical === true },
  );
  const method = prefix ? "title_prefix" : "title_exact";
  if (decision.status === "matched") {
    return {
      status: "matched",
      registryItemId: decision.registryItemId,
      method,
      candidates: null,
      note: decision.byPrice ? "Title tie broken by price" : null,
    };
  }
  if (decision.status === "ambiguous") {
    return {
      status: "ambiguous",
      registryItemId: null,
      method,
      candidates: decision.candidateIds,
      note: null,
    };
  }
  return {
    status: "unmatched",
    registryItemId: null,
    method: null,
    candidates: null,
    note: "No registry item with this title",
  };
}

export async function matchPending(
  limit = 500,
): Promise<Record<string, number>> {
  const pending = await rows(sql`
    SELECT id, venue, venue_listing_id, ebay_item_id, title, title_truncated, price,
           COALESCE(sold_at, detected_at) < now() - make_interval(days => ${PLAN_WINDOW_DAYS}) AS historical
    FROM sale_events WHERE status = 'pending' ORDER BY detected_at LIMIT ${limit}`);
  const counts: Record<string, number> = {};
  for (const e of pending) {
    const m = await matchOne(e);
    counts[m.status] = (counts[m.status] ?? 0) + 1;
    await exec(sql`
      UPDATE sale_events SET status = ${m.status}, registry_item_id = ${m.registryItemId},
             match_method = ${m.method},
             candidates = ${m.candidates ? JSON.stringify(m.candidates) : null}::jsonb,
             note = COALESCE(${m.note}, note), updated_at = now()
      WHERE id = ${String(e.id)} AND status = 'pending'`);
  }
  return counts;
}

/** Manually tie a sale to an item from the review queue. `ref` may be a
 *  registry id, an eBay item id, or the venue's own listing id. */
export async function resolveSaleManually(
  saleEventId: string,
  ref: string,
  who: string,
): Promise<{ ok: boolean; error?: string; registryItemId?: string }> {
  const [e] = await rows(
    sql`SELECT id, venue, status FROM sale_events WHERE id = ${saleEventId}`,
  );
  if (!e) return { ok: false, error: "Sale not found" };
  const r = ref.trim();
  let id: string | null = null;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r)
  ) {
    const [x] = await rows(sql`SELECT id FROM registry_items WHERE id = ${r}`);
    id = x ? String(x.id) : null;
  }
  if (!id) {
    const ebay = r.match(/(?:\/itm\/)?(\d{9,15})/);
    if (ebay) id = await findByEbayId(ebay[1]);
  }
  if (!id) id = await findByVenueId(String(e.venue), r);
  if (!id) return { ok: false, error: "No item found for that id" };
  await exec(sql`
    UPDATE sale_events SET status = 'matched', registry_item_id = ${id}, match_method = 'manual',
           candidates = NULL, resolved_by = ${who}, updated_at = now()
    WHERE id = ${saleEventId}`);
  return { ok: true, registryItemId: id };
}

export async function setSaleIgnored(
  saleEventId: string,
  ignored: boolean,
  who: string,
): Promise<boolean> {
  const n = await exec(sql`
    UPDATE sale_events
    SET status = ${ignored ? "ignored" : "pending"}, resolved_by = ${ignored ? who : null},
        registry_item_id = CASE WHEN ${ignored}::boolean THEN registry_item_id ELSE NULL END, updated_at = now()
    WHERE id = ${saleEventId} AND planned_at IS NULL`);
  return n > 0;
}

// ─── 3. plan ──────────────────────────────────────────────────────────────────

export async function planMatched(limit = 500): Promise<{
  planned: number;
  legs: number;
  history: number;
  duplicates: number;
  doubleSales: number;
}> {
  const out = {
    planned: 0,
    legs: 0,
    history: 0,
    duplicates: 0,
    doubleSales: 0,
  };
  const ready = await rows(sql`
    SELECT id, venue, venue_listing_id, registry_item_id, COALESCE(sold_at, detected_at) AS at,
           COALESCE(sold_at, detected_at) < now() - make_interval(days => ${PLAN_WINDOW_DAYS}) AS historical
    FROM sale_events
    WHERE status = 'matched' AND planned_at IS NULL AND registry_item_id IS NOT NULL
    ORDER BY COALESCE(sold_at, detected_at)
    LIMIT ${limit}`);

  for (const s of ready) {
    const id = String(s.id);
    const item = String(s.registry_item_id);
    const venue = String(s.venue);
    const at = new Date(String(s.at)).toISOString();

    // Multi-quantity stock (eBay listing with more than one unit left before
    // this sale): one unit sold, the item itself stays live.
    const [stock] = await rows(sql`
      SELECT e.quantity FROM registry_items r JOIN ebay_listings e ON e.item_id = r.primary_ebay_item_id
      WHERE r.id = ${item}`);
    const multiQty =
      venue !== "ebay" && stock != null && Number(stock.quantity) > 1;

    // Same item, another sale within a week: the same sale seen twice (same
    // venue) or a double sale (different venue). Not for multi-quantity
    // stock, where several units selling in a week is normal.
    const [other] = multiQty
      ? []
      : await rows(sql`
      SELECT id, venue FROM sale_events
      WHERE registry_item_id = ${item} AND id <> ${id} AND status = 'matched' AND planned_at IS NOT NULL
        AND abs(extract(epoch FROM (COALESCE(sold_at, detected_at) - ${at}::timestamptz))) < 7 * 86400
      ORDER BY COALESCE(sold_at, detected_at) LIMIT 1`);
    if (other && String(other.venue) === venue) {
      await exec(sql`
        UPDATE sale_events SET status = 'duplicate', duplicate_of = ${String(other.id)},
               planned_at = now(), updated_at = now() WHERE id = ${id}`);
      out.duplicates++;
      continue;
    }
    if (other) {
      await exec(sql`
        UPDATE sale_events SET flag = 'double_sale', updated_at = now()
        WHERE id IN (${id}, ${String(other.id)})`);
      out.doubleSales++;
    }

    let legs = 0;
    if (s.historical === true) {
      out.history++;
    } else if (!other) {
      // Every other listing of the item that may still be up. Etsy is
      // suspended (links are history) and the selling venue's own listing
      // is the one that sold. An eBay listing already at 0 whose mirror row
      // changed after the sale is planned too: Nifty probably ended it
      // before this run, and it should still count in the score.
      legs = await exec(sql`
        INSERT INTO delist_plans (sale_event_id, registry_item_id, venue, venue_listing_id, planned_action, evidence)
        SELECT ${id}, ${item}, v.venue, v.venue_listing_id,
               CASE WHEN v.venue = 'ebay' AND COALESCE(e.quantity, 0) > 1 THEN 'decrement'
                    WHEN v.venue = 'ebay' THEN 'end_ebay'
                    WHEN v.venue = 'hip' THEN 'close_hip'
                    ELSE 'delist' END,
               jsonb_build_object('status_at_plan', v.status, 'qty_at_plan', e.quantity)
        FROM venue_listings v
        LEFT JOIN ebay_listings e ON v.venue = 'ebay' AND e.item_id = v.venue_listing_id
        WHERE v.registry_item_id = ${item}
          AND v.venue <> ${venue} AND v.venue <> 'etsy'
          AND (v.status IN ('live', 'unknown')
               OR (v.venue = 'ebay' AND COALESCE(e.quantity, 0) > 0)
               OR (v.venue = 'ebay' AND e.last_synced_at >= ${at}::timestamptz))
        ON CONFLICT DO NOTHING`);
    }

    // The registry's own record: the item is sold, and so is the listing
    // it sold through (eBay and Hip rows stay owned by their API syncs).
    // Older sales (history / Gmail backfill) never change the registry: the
    // Nifty capture already reflects them, and a title match on an old sale
    // must not mark a live relist sold.
    if (!multiQty && s.historical !== true) {
      await exec(sql`
      UPDATE registry_items SET status = 'sold', sold_at = ${at}::timestamptz, sold_on_venue = ${venue},
             updated_at = now()
      WHERE id = ${item} AND status = 'live'`);
      await exec(sql`
      UPDATE venue_listings SET status = 'sold', updated_at = now(), last_seen_at = now()
      WHERE registry_item_id = ${item} AND venue = ${venue} AND venue NOT IN ('ebay', 'hip')
        AND status IN ('live', 'unknown')
        AND (${s.venue_listing_id as string | null}::text IS NULL OR venue_listing_id = ${s.venue_listing_id as string | null})`);
    }
    // A title-matched sale that carried the venue's own listing id (Mercari)
    // teaches the registry a link it didn't have.
    if (s.venue_listing_id && !["ebay", "hip", "tes", "fia"].includes(venue)) {
      await exec(sql`
        INSERT INTO venue_listings (registry_item_id, venue, venue_listing_id, status, link_source, link_confidence)
        VALUES (${item}, ${venue}, ${String(s.venue_listing_id)}, 'sold', 'sale_email', 'title')
        ON CONFLICT (venue, venue_listing_id) DO NOTHING`);
    }

    await exec(sql`
      UPDATE sale_events SET planned_at = now(), updated_at = now(),
             note = CASE WHEN ${s.historical === true}::boolean THEN COALESCE(note, 'Older sale: recorded for history only (no delist plan, registry unchanged)')
                         WHEN ${!!other}::boolean THEN COALESCE(note, 'Double sale: plan kept on the first sale')
                         WHEN ${multiQty}::boolean THEN COALESCE(note, 'Multi-quantity item: one unit sold, item stays live')
                         ELSE note END
      WHERE id = ${id}`);
    out.planned++;
    out.legs += legs;
  }
  return out;
}

// ─── 4. Nifty alerts + outcomes ───────────────────────────────────────────────

export async function linkNiftyAlerts(): Promise<{
  linked: number;
  failedLegs: number;
}> {
  // Tie each failure notice to the registry item with that exact title
  // (only when exactly one item has it).
  const linked = await exec(sql`
    UPDATE nifty_alerts a SET registry_item_id = x.rid
    FROM (
      SELECT a2.id, min(r.id::text)::uuid AS rid
      FROM nifty_alerts a2 JOIN registry_items r ON r.title_normalized = a2.title_normalized
      WHERE a2.registry_item_id IS NULL AND a2.title_normalized IS NOT NULL
      GROUP BY a2.id HAVING count(*) = 1
    ) x
    WHERE a.id = x.id`);
  // Several items share the title (relisted / duplicate stock): take the one
  // with a matched sale within two days of the notice, when there's exactly one.
  const linkedBySale = await exec(sql`
    UPDATE nifty_alerts a SET registry_item_id = x.rid
    FROM (
      SELECT a2.id, min(r.id::text)::uuid AS rid
      FROM nifty_alerts a2
      JOIN registry_items r ON r.title_normalized = a2.title_normalized
      JOIN sale_events e ON e.registry_item_id = r.id AND e.status = 'matched'
        AND abs(extract(epoch FROM (COALESCE(e.sold_at, e.detected_at) - a2.received_at))) < 2 * 86400
      WHERE a2.registry_item_id IS NULL AND a2.title_normalized IS NOT NULL
      GROUP BY a2.id HAVING count(DISTINCT r.id) = 1
    ) x
    WHERE a.id = x.id`);

  const failedLegs = await exec(sql`
    UPDATE delist_plans p
    SET outcome = 'failed_nifty', outcome_at = a.received_at, checked_at = now(),
        evidence = COALESCE(p.evidence, '{}'::jsonb) || jsonb_build_object('nifty_reason', f->>'reason', 'nifty_alert', a.id)
    FROM nifty_alerts a CROSS JOIN LATERAL jsonb_array_elements(a.failed) f
    WHERE a.registry_item_id = p.registry_item_id AND p.venue = f->>'venue'
      AND p.outcome IN ('pending', 'still_live', 'unverified')
      AND a.received_at >= p.planned_at - interval '1 day'`);
  return { linked: linked + linkedBySale, failedLegs };
}

export async function checkOutcomes(): Promise<Record<string, number>> {
  const win = sql`p.planned_at > now() - make_interval(days => ${OUTCOME_WINDOW_DAYS})`;
  const open = sql`p.outcome IN ('pending', 'still_live', 'unverified', 'failed_nifty')`;
  const out: Record<string, number> = {};

  // eBay: the mirror (15-minute events) shows the listing sold out / ended.
  out.ebayDone = await exec(sql`
    UPDATE delist_plans p
    SET outcome = 'done', outcome_at = now(), checked_at = now(),
        evidence = COALESCE(p.evidence, '{}'::jsonb) || jsonb_build_object('ebay_quantity', e.quantity, 'source', 'ebay_mirror')
    FROM delist_plans p2 LEFT JOIN ebay_listings e ON e.item_id = p2.venue_listing_id
    WHERE p.id = p2.id AND p.venue = 'ebay' AND ${open} AND ${win}
      AND (e.item_id IS NULL
           OR (p.planned_action = 'end_ebay' AND COALESCE(e.quantity, 0) = 0)
           OR (p.planned_action = 'decrement' AND e.quantity < (p.evidence->>'qty_at_plan')::int))`);

  // Hip: the listing map shows it closed / inactive (or gone).
  out.hipDone = await exec(sql`
    UPDATE delist_plans p
    SET outcome = 'done', outcome_at = now(), checked_at = now(),
        evidence = COALESCE(p.evidence, '{}'::jsonb) || jsonb_build_object('source', 'hip_listings')
    FROM delist_plans p2 LEFT JOIN hip_listings h ON h.hip_id::text = p2.venue_listing_id
    WHERE p.id = p2.id AND p.venue = 'hip' AND ${open} AND ${win}
      AND (h.hip_id IS NULL OR NOT h.active OR h.closed)`);

  // Mercari / Poshmark / Depop / Whatnot: a Nifty Sync capture reported the
  // listing DELISTED / SOLD.
  out.niftyDone = await exec(sql`
    UPDATE delist_plans p
    SET outcome = 'done', outcome_at = now(), checked_at = now(),
        evidence = COALESCE(p.evidence, '{}'::jsonb) || jsonb_build_object('source', 'nifty_capture', 'status', v.status)
    FROM venue_listings v
    WHERE v.venue = p.venue AND v.venue_listing_id = p.venue_listing_id
      AND p.venue NOT IN ('ebay', 'hip') AND ${open} AND ${win}
      AND v.status IN ('ended', 'sold')`);

  // Still up an hour later where we can see it (eBay, Hip, or a capture
  // after the plan that still says live).
  out.stillLive = await exec(sql`
    UPDATE delist_plans p SET outcome = 'still_live', checked_at = now()
    FROM delist_plans p2 LEFT JOIN venue_listings v ON v.venue = p2.venue AND v.venue_listing_id = p2.venue_listing_id
    WHERE p.id = p2.id AND p.outcome IN ('pending', 'unverified') AND ${win}
      AND p.planned_at < now() - interval '1 hour'
      AND (p.venue IN ('ebay', 'hip') OR (v.status = 'live' AND v.last_seen_at > p.planned_at))`);

  // No evidence either way after a day (no capture since the sale).
  out.unverified = await exec(sql`
    UPDATE delist_plans p SET outcome = 'unverified', checked_at = now()
    WHERE p.outcome = 'pending' AND p.planned_at < now() - interval '24 hours'`);

  await exec(
    sql`UPDATE delist_plans p SET checked_at = now() WHERE ${open} AND ${win}`,
  );
  return out;
}

// ─── run ──────────────────────────────────────────────────────────────────────

export type SalesSyncResult = {
  ok: boolean;
  ready: boolean;
  ms: number;
  steps: Record<string, unknown>;
  errors: string[];
};

export async function runSalesSync(): Promise<SalesSyncResult> {
  const started = Date.now();
  const steps: Record<string, unknown> = {};
  const errors: string[] = [];
  if (!(await salesTablesReady())) {
    return { ok: true, ready: false, ms: Date.now() - started, steps, errors };
  }
  const run = async (name: string, fn: () => Promise<unknown>) => {
    try {
      steps[name] = await fn();
    } catch (err) {
      errors.push(
        `${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  await run("hip", ingestHip);
  await run("stripe", ingestStripe);
  await run("email", () => ingestEmails());
  await run("match", () => matchPending());
  await run("plan", () => planMatched());
  await run("niftyAlerts", linkNiftyAlerts);
  await run("outcomes", checkOutcomes);
  return {
    ok: errors.length === 0,
    ready: true,
    ms: Date.now() - started,
    steps,
    errors,
  };
}
