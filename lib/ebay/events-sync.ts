// Delta sync: eBay → ebay_listings mirror, via GetSellerEvents.
//
// The full GetSellerList sweep (listing-sync.ts) walks the whole store
// and now runs daily. This module is the fast path between sweeps: one
// GetSellerEvents call returns only listings that CHANGED since the last
// check — sold out, ended, price or quantity revised — so a 15-minute
// cron keeps the storefront (FIA /shop and The Ephemeral State) from
// showing items that sold days ago.
//
// Scope: updates quantity/price/status for rows already in the mirror.
// Brand-new listings are NOT inserted here (GetSellerEvents items are
// sparse — store categories etc. may be missing); they arrive with the
// daily sweep, which is fine: a new listing showing up a day late is
// additive, a sold listing showing for a day is an oversell risk.
//
// Cursor: app_settings key "listingEventsCursor" stores the end of the
// last successfully processed window. Each run re-reads a 2-minute
// overlap (eBay mod-times vs our clock) and lags ModTimeTo 2 minutes
// behind now (per eBay guidance, avoids missing in-flight updates).
// If the cursor is very old (first run, or the cron was down), the
// lookback clamps to ~46h — GetSellerEvents windows are capped at 48h,
// and anything older is the daily sweep's problem anyway.

import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, ebaySyncLog, appSettings } from "@/db/schema";
import { tradingCall } from "@/lib/ebay/client";

const CURSOR_KEY = "listingEventsCursor";
const OVERLAP_MS = 2 * 60_000;
const TO_LAG_MS = 2 * 60_000;
const MAX_LOOKBACK_MS = 46 * 3600_000;
const FIRST_RUN_LOOKBACK_MS = 24 * 3600_000;

type EventsCursor = { lastTo: string | null };

async function loadCursor(): Promise<EventsCursor> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(sql`${appSettings.key} = ${CURSOR_KEY}`)
    .limit(1);
  if (!row || typeof row.value !== "object" || row.value === null) {
    return { lastTo: null };
  }
  return { lastTo: null, ...(row.value as Partial<EventsCursor>) };
}

async function saveCursor(cursor: EventsCursor): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: CURSOR_KEY, value: cursor, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: cursor, updatedAt: new Date() },
    });
}

type ItemDelta = {
  itemId: string;
  /** Available quantity (Quantity − QuantitySold), 0 for ended/sold. */
  quantity: number | null;
  price: string | null;
  ended: boolean;
};

function parsePrice(currentPrice: unknown): string | null {
  if (currentPrice == null) return null;
  if (typeof currentPrice === "object") {
    const t = (currentPrice as Record<string, unknown>)["#text"];
    return t != null ? String(t) : null;
  }
  return String(currentPrice);
}

function normalizeEvent(item: unknown): ItemDelta | null {
  const i = item as Record<string, unknown>;
  const itemId = i.ItemID != null ? String(i.ItemID) : "";
  if (!itemId) return null;

  const sellingStatus =
    (i.SellingStatus as Record<string, unknown> | undefined) ?? {};
  const listingStatus =
    sellingStatus.ListingStatus != null
      ? String(sellingStatus.ListingStatus)
      : null;
  const ended = listingStatus === "Completed" || listingStatus === "Ended";

  const totalQty = i.Quantity != null ? Number(i.Quantity) : null;
  const qtySold =
    sellingStatus.QuantitySold != null
      ? Number(sellingStatus.QuantitySold)
      : 0;
  const available = ended
    ? 0
    : totalQty != null && Number.isFinite(totalQty)
      ? Math.max(0, totalQty - (Number.isFinite(qtySold) ? qtySold : 0))
      : null;

  return {
    itemId,
    quantity: available,
    price: parsePrice(sellingStatus.CurrentPrice),
    ended,
  };
}

export type EventsSyncResult = {
  windowFrom: string;
  windowTo: string;
  /** Changed listings eBay reported in the window. */
  scanned: number;
  /** Mirror rows actually updated. */
  updated: number;
  /** Of those, rows whose available quantity hit 0 (sold/ended). */
  zeroed: number;
  /** Events for items not in the mirror (new listings — daily sweep's job). */
  skippedUnknown: number;
  noop: boolean;
};

export async function syncListingEventsDelta(): Promise<EventsSyncResult> {
  const startedAt = new Date();
  const nowMs = Date.now();
  const toMs = nowMs - TO_LAG_MS;

  const cursor = await loadCursor();
  let fromMs = cursor.lastTo
    ? new Date(cursor.lastTo).getTime() - OVERLAP_MS
    : nowMs - FIRST_RUN_LOOKBACK_MS;
  fromMs = Math.max(fromMs, nowMs - MAX_LOOKBACK_MS);

  const windowFrom = new Date(fromMs).toISOString();
  const windowTo = new Date(toMs).toISOString();

  if (fromMs >= toMs) {
    return {
      windowFrom,
      windowTo,
      scanned: 0,
      updated: 0,
      zeroed: 0,
      skippedUnknown: 0,
      noop: true,
    };
  }

  const res = await tradingCall("GetSellerEvents", {
    ModTimeFrom: windowFrom,
    ModTimeTo: windowTo,
    DetailLevel: "ReturnAll",
    HideVariations: "true",
  });

  const itemArray = (res as { ItemArray?: { Item?: unknown } }).ItemArray;
  const rawItems = itemArray?.Item;
  const arr = !rawItems ? [] : Array.isArray(rawItems) ? rawItems : [rawItems];
  const deltas = arr
    .map(normalizeEvent)
    .filter((d): d is ItemDelta => d !== null);

  let updated = 0;
  let zeroed = 0;
  let skippedUnknown = 0;

  if (deltas.length > 0) {
    // Which of these live in the mirror? (New listings are skipped — the
    // daily sweep inserts them with full category/image data.)
    const known = new Set(
      (
        await db
          .select({ itemId: ebayListings.itemId })
          .from(ebayListings)
          .where(
            inArray(
              ebayListings.itemId,
              deltas.map((d) => d.itemId)
            )
          )
      ).map((r) => r.itemId)
    );

    for (const d of deltas) {
      if (!known.has(d.itemId)) {
        skippedUnknown++;
        continue;
      }
      const set: Record<string, unknown> = { lastSyncedAt: new Date() };
      if (d.quantity != null) set.quantity = d.quantity;
      if (d.price != null) set.price = d.price;
      if (d.quantity == null && d.price == null) continue; // nothing usable
      await db
        .update(ebayListings)
        .set(set)
        .where(sql`${ebayListings.itemId} = ${d.itemId}`);
      updated++;
      if (d.quantity === 0) zeroed++;
    }
  }

  await saveCursor({ lastTo: windowTo });

  // Keep the sync log readable: only record runs that changed something
  // (or that scanned events at all) — not 96 empty ticks a day.
  if (deltas.length > 0) {
    await db.insert(ebaySyncLog).values({
      action: "events-delta-sync",
      success: true,
      itemCount: updated,
      details: {
        windowFrom,
        windowTo,
        scanned: deltas.length,
        zeroed,
        skippedUnknown,
      },
      startedAt,
      endedAt: new Date(),
    });
  }

  return {
    windowFrom,
    windowTo,
    scanned: deltas.length,
    updated,
    zeroed,
    skippedUnknown,
    noop: false,
  };
}
