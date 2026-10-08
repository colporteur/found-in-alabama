// Item Registry sync (Phase REG-1).
//
// Builds and maintains registry_items / venue_listings / registry_review from
// data the app already holds:
//   • items          — Nifty capture (FIA Nifty Sync extension): Nifty id, haul
//                      slug, sold state, and a URL per marketplace
//   • ebay_listings  — the eBay mirror (daily sweep + 15-min events). Its
//                      `quantity` is AVAILABLE quantity: 0 = sold out, even
//                      though eBay keeps the listing open until its end time
//   • hip_listings   — Hip listing ↔ eBay item id
//
// Every statement is idempotent, so the whole sync is safe to re-run (hourly
// cron + the "Run sync" button on /admin/registry). It reads the source tables
// and writes ONLY the four registry tables. Nothing is sent to eBay, Nifty,
// Hip or any marketplace.
//
// The registry id is the item identity. SKU stays a storage-bin code.

import { db } from "@/db";
import { sql } from "drizzle-orm";

/** Pulls the eBay item id out of a Nifty marketplace URL (…/itm/<id>). */
const EBAY_ID_FROM_ITEM = `substring(i.marketplace_urls->>'ebay' from '/itm/(\\d+)')`;

/**
 * Venue listing id from a stored marketplace URL, normalized to the raw id
 * Nifty reports (URL-decoded — Whatnot ids are base64 and end in '=').
 */
const VENUE_ID_FROM_URL = `
  CASE venue
    WHEN 'ebay'     THEN substring(url from '/itm/(\\d+)')
    WHEN 'mercari'  THEN substring(url from '/item/(m\\d+)')
    WHEN 'poshmark' THEN substring(url from '/listing/([0-9a-f]+)')
    WHEN 'depop'    THEN substring(url from '/products/([^/?#]+)')
    WHEN 'whatnot'  THEN replace(replace(replace(substring(url from '/listing/([^/?#]+)'),
                           '%3D', '='), '%2B', '+'), '%2F', '/')
    WHEN 'etsy'     THEN substring(url from '/listing/(\\d+)')
  END`;

/** Review kinds the sync computes (open rows are rebuilt every run). */
export const AUTO_REVIEW_KINDS = [
  "ebay_not_in_nifty",
  "nifty_active_ebay_missing",
  "nifty_active_no_ebay",
] as const;

type Step = { name: string; sql: string };

export const REGISTRY_SYNC_STEPS: Step[] = [
  {
    name: "seed venue status",
    sql: `
      INSERT INTO venue_status (venue, state, note) VALUES
        ('ebay','connected','Official API (FIA)'),
        ('hip','connected','Hip API (FIA)'),
        ('tes','connected','Own site'),
        ('fia','connected','Own site'),
        ('mercari','via_nifty','Crosslisted through Nifty'),
        ('poshmark','via_nifty','Crosslisted through Nifty'),
        ('depop','via_nifty','Crosslisted through Nifty'),
        ('whatnot','via_nifty','Crosslisted through Nifty'),
        ('etsy','suspended','Etsy account suspended - links are historical only')
      ON CONFLICT (venue) DO NOTHING`,
  },
  {
    name: "new active Nifty items",
    sql: `
      INSERT INTO registry_items (status, title, title_normalized, bin_sku, nifty_item_ref,
                                  nifty_id, primary_ebay_item_id, haul_post_slug, created_from)
      SELECT 'live', i.title, i.title_normalized, i.sku, i.id, i.nifty_id,
             CASE WHEN EXISTS (SELECT 1 FROM registry_items o WHERE o.primary_ebay_item_id = ${EBAY_ID_FROM_ITEM})
                  THEN NULL ELSE ${EBAY_ID_FROM_ITEM} END,
             i.haul_post_slug, 'nifty_backfill'
      FROM items i
      WHERE i.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM registry_items r WHERE r.nifty_item_ref = i.id)
      ON CONFLICT DO NOTHING`,
  },
  {
    name: "new sold Nifty items",
    sql: `
      INSERT INTO registry_items (status, title, title_normalized, bin_sku, nifty_item_ref,
                                  nifty_id, primary_ebay_item_id, haul_post_slug, sold_at,
                                  sold_on_venue, created_from)
      SELECT 'sold', i.title, i.title_normalized, i.sku, i.id, i.nifty_id,
             CASE WHEN EXISTS (SELECT 1 FROM registry_items o WHERE o.primary_ebay_item_id = ${EBAY_ID_FROM_ITEM})
                  THEN NULL ELSE ${EBAY_ID_FROM_ITEM} END,
             i.haul_post_slug, i.sold_at, i.sold_on_marketplace, 'nifty_backfill'
      FROM items i
      WHERE i.status = 'sold'
        AND NOT EXISTS (SELECT 1 FROM registry_items r WHERE r.nifty_item_ref = i.id)
      ON CONFLICT DO NOTHING`,
  },
  // A listing first seen in the eBay mirror (no Nifty record yet) that Nifty
  // has since captured: fold the eBay-only registry row into the Nifty one.
  {
    name: "merge: move listings to the Nifty item",
    sql: `
      UPDATE venue_listings v SET registry_item_id = n.id, updated_at = now()
      FROM registry_items d
      JOIN items i ON i.status = 'active' AND ${EBAY_ID_FROM_ITEM} = d.primary_ebay_item_id
      JOIN registry_items n ON n.nifty_item_ref = i.id
      WHERE d.created_from = 'ebay_backfill' AND v.registry_item_id = d.id AND n.id <> d.id`,
  },
  {
    name: "merge: remove the eBay-only duplicate",
    sql: `
      DELETE FROM registry_items d
      USING items i, registry_items n
      WHERE d.created_from = 'ebay_backfill'
        AND i.status = 'active' AND ${EBAY_ID_FROM_ITEM} = d.primary_ebay_item_id
        AND n.nifty_item_ref = i.id AND n.id <> d.id`,
  },
  {
    name: "relisted: follow Nifty's current eBay id",
    sql: `
      UPDATE registry_items r SET primary_ebay_item_id = x.eid, updated_at = now()
      FROM (SELECT i.id, ${EBAY_ID_FROM_ITEM} AS eid FROM items i WHERE i.status = 'active') x
      WHERE r.nifty_item_ref = x.id AND x.eid IS NOT NULL
        AND r.primary_ebay_item_id IS DISTINCT FROM x.eid
        AND NOT EXISTS (SELECT 1 FROM registry_items o WHERE o.primary_ebay_item_id = x.eid AND o.id <> r.id)`,
  },
  {
    name: "Nifty status, title, bin, haul",
    sql: `
      UPDATE registry_items r SET
        status = CASE WHEN i.status = 'sold' THEN 'sold' ELSE 'live' END,
        sold_at = CASE WHEN i.status = 'sold' THEN i.sold_at ELSE NULL END,
        sold_on_venue = CASE WHEN i.status = 'sold' THEN i.sold_on_marketplace ELSE NULL END,
        title = i.title, title_normalized = i.title_normalized,
        bin_sku = i.sku, haul_post_slug = i.haul_post_slug, updated_at = now()
      FROM items i
      WHERE r.nifty_item_ref = i.id AND r.status IN ('live', 'sold')
        AND (r.status IS DISTINCT FROM CASE WHEN i.status = 'sold' THEN 'sold' ELSE 'live' END
             OR r.title IS DISTINCT FROM i.title
             OR r.bin_sku IS DISTINCT FROM i.sku
             OR r.haul_post_slug IS DISTINCT FROM i.haul_post_slug)`,
  },
  {
    name: "eBay listings with no Nifty record",
    sql: `
      INSERT INTO registry_items (status, title, title_normalized, bin_sku, primary_ebay_item_id, created_from)
      SELECT CASE WHEN e.quantity > 0 THEN 'live' ELSE 'sold' END,
             e.title, lower(trim(e.title)), e.sku, e.item_id, 'ebay_backfill'
      FROM ebay_listings e
      WHERE NOT EXISTS (SELECT 1 FROM registry_items r WHERE r.primary_ebay_item_id = e.item_id)
      ON CONFLICT DO NOTHING`,
  },
  {
    name: "eBay-only item status from quantity",
    sql: `
      UPDATE registry_items r
      SET status = CASE WHEN e.quantity > 0 THEN 'live' ELSE 'sold' END, updated_at = now()
      FROM ebay_listings e
      WHERE r.created_from = 'ebay_backfill' AND e.item_id = r.primary_ebay_item_id
        AND r.status IN ('live', 'sold')
        AND r.status IS DISTINCT FROM CASE WHEN e.quantity > 0 THEN 'live' ELSE 'sold' END`,
  },
  {
    name: "eBay venue listings",
    sql: `
      INSERT INTO venue_listings (registry_item_id, venue, venue_listing_id, url, status, price, link_source)
      SELECT r.id, 'ebay', e.item_id, 'https://www.ebay.com/itm/' || e.item_id,
             CASE WHEN e.quantity > 0 THEN 'live' ELSE 'sold' END, e.price, 'ebay_sync'
      FROM ebay_listings e JOIN registry_items r ON r.primary_ebay_item_id = e.item_id
      ON CONFLICT (venue, venue_listing_id) DO UPDATE
        SET registry_item_id = EXCLUDED.registry_item_id, status = EXCLUDED.status,
            price = EXCLUDED.price, last_seen_at = now(), updated_at = now()
        WHERE venue_listings.status IS DISTINCT FROM EXCLUDED.status
           OR venue_listings.price IS DISTINCT FROM EXCLUDED.price
           OR venue_listings.registry_item_id IS DISTINCT FROM EXCLUDED.registry_item_id`,
  },
  {
    name: "eBay listings gone from the mirror → ended",
    sql: `
      UPDATE venue_listings v SET status = 'ended', updated_at = now()
      WHERE v.venue = 'ebay' AND v.status = 'live'
        AND NOT EXISTS (SELECT 1 FROM ebay_listings e WHERE e.item_id = v.venue_listing_id)`,
  },
  {
    name: "other venues from Nifty links",
    sql: `
      WITH urls AS (
        SELECT r.id AS rid, i.status AS istatus, i.sold_on_marketplace, m.k AS venue, m.v AS url
        FROM items i
        JOIN registry_items r ON r.nifty_item_ref = i.id
        CROSS JOIN LATERAL jsonb_each_text(i.marketplace_urls) AS m(k, v)
        WHERE m.k <> 'ebay'
      ), parsed AS (
        SELECT rid, venue, url, ${VENUE_ID_FROM_URL} AS vid,
               CASE WHEN venue = 'etsy' THEN 'ended'
                    WHEN istatus = 'sold' AND sold_on_marketplace = venue THEN 'sold'
                    WHEN istatus = 'sold' THEN 'ended'
                    ELSE 'unknown' END AS vstatus
        FROM urls
      )
      INSERT INTO venue_listings (registry_item_id, venue, venue_listing_id, url, status, link_source)
      SELECT rid, venue, vid, url, vstatus, 'nifty_capture'
      FROM parsed WHERE vid IS NOT NULL
      ON CONFLICT (venue, venue_listing_id) DO NOTHING`,
  },
  {
    name: "sold items: close their other listings",
    sql: `
      UPDATE venue_listings v
      SET status = CASE WHEN r.sold_on_venue = v.venue THEN 'sold' ELSE 'ended' END, updated_at = now()
      FROM registry_items r
      WHERE v.registry_item_id = r.id AND r.status = 'sold'
        AND v.venue NOT IN ('ebay', 'hip') AND v.status IN ('unknown', 'live')`,
  },
  {
    name: "Hip venue listings",
    sql: `
      INSERT INTO venue_listings (registry_item_id, venue, venue_listing_id, url, status, price, link_source)
      SELECT r.id, 'hip', h.hip_id::text, h.url,
             CASE WHEN h.active AND NOT h.closed THEN 'live' ELSE 'ended' END, h.price, 'hip_sync'
      FROM hip_listings h JOIN registry_items r ON r.primary_ebay_item_id = h.external_id
      ON CONFLICT (venue, venue_listing_id) DO UPDATE
        SET registry_item_id = EXCLUDED.registry_item_id, status = EXCLUDED.status,
            price = EXCLUDED.price, last_seen_at = now(), updated_at = now()
        WHERE venue_listings.status IS DISTINCT FROM EXCLUDED.status
           OR venue_listings.price IS DISTINCT FROM EXCLUDED.price
           OR venue_listings.registry_item_id IS DISTINCT FROM EXCLUDED.registry_item_id`,
  },
  {
    name: "review: clear open auto rows",
    sql: `DELETE FROM registry_review WHERE status = 'open' AND kind IN (${AUTO_REVIEW_KINDS.map((k) => `'${k}'`).join(", ")})`,
  },
  {
    name: "review: for sale on eBay, no Nifty record",
    sql: `
      INSERT INTO registry_review (kind, registry_item_id, detail)
      SELECT 'ebay_not_in_nifty', r.id,
             jsonb_build_object('ebay_item_id', r.primary_ebay_item_id, 'title', r.title, 'bin', r.bin_sku)
      FROM registry_items r WHERE r.created_from = 'ebay_backfill' AND r.status = 'live'
      ON CONFLICT (kind, registry_item_id) DO NOTHING`,
  },
  {
    name: "review: Nifty active, eBay listing not in mirror",
    sql: `
      INSERT INTO registry_review (kind, registry_item_id, detail)
      SELECT 'nifty_active_ebay_missing', r.id,
             jsonb_build_object('ebay_item_id', r.primary_ebay_item_id, 'title', r.title, 'bin', r.bin_sku,
                                'first_captured', i.captured_at)
      FROM registry_items r JOIN items i ON i.id = r.nifty_item_ref
      WHERE r.status = 'live' AND r.primary_ebay_item_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ebay_listings e WHERE e.item_id = r.primary_ebay_item_id)
      ON CONFLICT (kind, registry_item_id) DO NOTHING`,
  },
  {
    name: "review: Nifty active, no eBay link",
    sql: `
      INSERT INTO registry_review (kind, registry_item_id, detail)
      SELECT 'nifty_active_no_ebay', r.id, jsonb_build_object('title', r.title, 'bin', r.bin_sku)
      FROM registry_items r
      WHERE r.created_from = 'nifty_backfill' AND r.status = 'live' AND r.primary_ebay_item_id IS NULL
      ON CONFLICT (kind, registry_item_id) DO NOTHING`,
  },
];

export type RegistrySyncResult = {
  ok: boolean;
  ms: number;
  steps: { name: string; rows: number | null; ms: number }[];
  error?: string;
};

/** Run the full, idempotent registry sync. */
export async function runRegistrySync(): Promise<RegistrySyncResult> {
  const started = Date.now();
  const steps: RegistrySyncResult["steps"] = [];
  for (const step of REGISTRY_SYNC_STEPS) {
    const t = Date.now();
    try {
      const res = (await db.execute(sql.raw(step.sql))) as { rowCount?: number | null };
      steps.push({ name: step.name, rows: res.rowCount ?? null, ms: Date.now() - t });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        ms: Date.now() - started,
        steps,
        error: `Step "${step.name}" failed: ${message}`,
      };
    }
  }
  return { ok: true, ms: Date.now() - started, steps };
}

// ─── Capture hook ─────────────────────────────────────────────────────────────
// Called by /api/admin/items/capture after each batch. Nifty's per-platform
// metadata carries the listing status (LISTED / SOLD / DELISTED), which the
// stored URLs don't — so this is where Mercari/Poshmark/Depop/Whatnot
// listings get a real status instead of "unknown".

export type CapturedListing = {
  niftyId: string;
  /** Raw marketplace name as Nifty reports it ("eBay", "Poshmark", …). */
  marketplace: string;
  externalId: string;
  status: string | null;
  url: string | null;
};

const VENUES = new Set(["ebay", "etsy", "poshmark", "mercari", "depop", "whatnot"]);

function venueStatus(nifty: string | null): string {
  switch ((nifty ?? "").toUpperCase()) {
    case "LISTED":
      return "live";
    case "SOLD":
      return "sold";
    case "DELISTED":
    case "ENDED":
      return "ended";
    default:
      return "unknown";
  }
}

/**
 * Make sure each captured Nifty item has a registry row, and record its
 * per-venue listing status. Never throws — the capture must succeed even if
 * the registry tables don't exist yet (before the REG-1 migration runs).
 */
export async function syncRegistryFromCapture(
  listings: CapturedListing[]
): Promise<{ ok: boolean; venueRows: number; error?: string }> {
  if (listings.length === 0) return { ok: true, venueRows: 0 };
  try {
    const niftyIds = Array.from(new Set(listings.map((l) => l.niftyId)));

    // 1. Registry rows for any newly captured items (same rules as the full sync).
    await db.execute(sql`
      INSERT INTO registry_items (status, title, title_normalized, bin_sku, nifty_item_ref, nifty_id,
                                  primary_ebay_item_id, haul_post_slug, sold_at, sold_on_venue, created_from)
      SELECT CASE WHEN i.status = 'sold' THEN 'sold' ELSE 'live' END,
             i.title, i.title_normalized, i.sku, i.id, i.nifty_id,
             CASE WHEN EXISTS (SELECT 1 FROM registry_items o
                               WHERE o.primary_ebay_item_id = substring(i.marketplace_urls->>'ebay' from '/itm/(\\d+)'))
                  THEN NULL ELSE substring(i.marketplace_urls->>'ebay' from '/itm/(\\d+)') END,
             i.haul_post_slug,
             CASE WHEN i.status = 'sold' THEN i.sold_at END,
             CASE WHEN i.status = 'sold' THEN i.sold_on_marketplace END,
             'nifty_backfill'
      FROM items i
      WHERE i.nifty_id IN (${sql.join(niftyIds.map((id) => sql`${id}`), sql`, `)})
        AND NOT EXISTS (SELECT 1 FROM registry_items r WHERE r.nifty_item_ref = i.id)
      ON CONFLICT DO NOTHING`);

    // 2. Venue listings with Nifty's own status. eBay and Hip status stay
    //    owned by their API syncs, so eBay rows are only created here, never
    //    overwritten.
    let venueRows = 0;
    for (const l of listings) {
      const venue = l.marketplace.toLowerCase().trim();
      if (!VENUES.has(venue) || !l.externalId) continue;
      const status = venue === "etsy" ? "ended" : venueStatus(l.status);
      const res = (await db.execute(sql`
        INSERT INTO venue_listings (registry_item_id, venue, venue_listing_id, url, status, link_source)
        SELECT r.id, ${venue}, ${l.externalId}, ${l.url}, ${status}, 'nifty_capture'
        FROM registry_items r JOIN items i ON i.id = r.nifty_item_ref
        WHERE i.nifty_id = ${l.niftyId}
        ON CONFLICT (venue, venue_listing_id) DO UPDATE
          SET status = EXCLUDED.status, url = COALESCE(EXCLUDED.url, venue_listings.url),
              last_seen_at = now(), updated_at = now()
          WHERE venue_listings.venue NOT IN ('ebay', 'hip')
            AND venue_listings.status IS DISTINCT FROM EXCLUDED.status`)) as {
        rowCount?: number | null;
      };
      venueRows += res.rowCount ?? 0;
    }
    return { ok: true, venueRows };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[registry] capture hook skipped: ${message}`);
    return { ok: false, venueRows: 0, error: message };
  }
}
