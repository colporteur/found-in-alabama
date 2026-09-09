// Hip sale ingestion (Phase HIP-1): the Hip → everywhere-else direction.
//
// Every ~15 minutes the cron pulls paid sales from Hip since the cursor,
// and for each NEW sale decides, line by line, who won the race:
//
//   eBay still Active with stock  → HIP WINS. End the eBay listing now
//                                   (seconds), decrement the mirror so
//                                   both storefronts drop it, and insert a
//                                   tes_orders row (source = "hip") so the
//                                   TES Actuator extension runs the Nifty
//                                   bulk Delist for the other venues.
//   eBay sold (QuantitySold covers) → CANCEL HIP. Todd's rule: Hip is the
//                                   lowest-priority venue; the Hip order
//                                   is the one that gets canceled. Nothing
//                                   is written anywhere; the board and an
//                                   email say so.
//   eBay ended WITHOUT a sale      → Hip wins (something else — Hip's own
//                                   sync, a manual end — already ended it).
//                                   Still queue the Nifty delist.
//   no eBay id resolvable          → manual_match (nothing automated).
//   line leaves stock on eBay      → manual_qty (a Nifty Delist would kill
//                                   the remaining units; mirror is
//                                   decremented, eBay untouched).
//   eBay API error                 → unverified (never end blind).
//
// Window: Hip's /sales/paid filters on the sale's CREATED time, but a
// buyer can pay hours after checkout (unpaid → paid), so a tight cursor
// window would miss late payers. Every run therefore re-reads the last
// LOOKBACK_DAYS of created sales (one or two pages at Todd's volume) and
// relies on idempotency: hip_sales.hip_sale_id is the primary key and the
// insert is onConflictDoNothing, so already-seen sales cost nothing. The
// cursor (app_settings "hipSalesCursor") is bookkeeping — "last clean
// run" — not the window's lower bound.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appSettings,
  ebayListings,
  hipActions,
  hipListings,
  hipSales,
  tesOrderItems,
  tesOrders,
} from "@/db/schema";
import { endFixedPriceItem, getLiveItemStatus } from "@/lib/ebay/calls";
import {
  ebayItemIdFromHip,
  findPaidSales,
  getListing,
  hipConfig,
  hipConfigured,
  type HipListing,
  type HipSale,
  type HipSaleListing,
} from "@/lib/hip/client";
import { esc, sendAdminEmail } from "@/lib/hip/notify";

const CURSOR_KEY = "hipSalesCursor";
const LOOKBACK_MS = 7 * 24 * 3600_000;
const PAGE_LIMIT = 50;
const MAX_PAGES = 20;

export type HipLineDecision =
  | "hip_wins"
  | "cancel_hip"
  | "manual_match"
  | "manual_qty"
  | "unverified";

export type HipSaleLine = {
  hipListingId: number;
  hipSaleListingId: number;
  title: string;
  quantity: number;
  price: number;
  privateId: string | null;
  /** eBay item id, when resolvable. */
  itemId: string | null;
  matchedBy: "external_id" | "title" | null;
  decision: HipLineDecision;
  reason: string;
  ebayEnded: boolean;
  ebayEndDetail?: string;
};

export type HipSaleDecision = HipLineDecision | "mixed" | "processing";

export type HipIngestResult = {
  configured: boolean;
  windowFrom: string | null;
  windowTo: string | null;
  fetched: number;
  newSales: number;
  decisions: Record<string, number>;
  errors: string[];
};

// ─── Cursor ──────────────────────────────────────────────────────────────────

type Cursor = { lastTo: string | null };
export type { Cursor as HipSalesCursor };

async function loadCursor(): Promise<Cursor> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, CURSOR_KEY))
    .limit(1);
  if (!row || typeof row.value !== "object" || row.value === null) return { lastTo: null };
  return { lastTo: null, ...(row.value as Partial<Cursor>) };
}

async function saveCursor(cursor: Cursor): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: CURSOR_KEY, value: cursor, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: cursor, updatedAt: new Date() },
    });
}

// ─── Hip listing map ─────────────────────────────────────────────────────────

export async function upsertHipListing(l: HipListing): Promise<void> {
  const externalId = ebayItemIdFromHip(l);
  await db
    .insert(hipListings)
    .values({
      hipId: l.id,
      externalId,
      externalIdType: l.external_id_type ?? null,
      privateId: l.private_id ?? null,
      title: l.name,
      price: l.current_price != null ? String(l.current_price) : null,
      quantity: l.quantity ?? null,
      active: l.active ?? !(l.closed ?? false),
      closed: l.closed ?? false,
      url: l.url ?? null,
      hipUpdatedAt: l.updated_at ? new Date(l.updated_at) : null,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: hipListings.hipId,
      set: {
        externalId,
        externalIdType: l.external_id_type ?? null,
        privateId: l.private_id ?? null,
        title: l.name,
        price: l.current_price != null ? String(l.current_price) : null,
        quantity: l.quantity ?? null,
        active: l.active ?? !(l.closed ?? false),
        closed: l.closed ?? false,
        url: l.url ?? null,
        hipUpdatedAt: l.updated_at ? new Date(l.updated_at) : null,
        lastSeenAt: new Date(),
      },
    });
}

/**
 * Resolve a Hip listing id to an eBay item id: the map first, then a live
 * GET /listings/{id} (which also refreshes the map), then — last resort —
 * a UNIQUE exact-title match against the eBay mirror (the same key the
 * Nifty actuator relies on). SKUs are bin numbers and are never a key.
 */
async function resolveEbayItemId(
  line: HipSaleListing
): Promise<{ itemId: string | null; matchedBy: HipSaleLine["matchedBy"]; note: string }> {
  const [mapped] = await db
    .select({ externalId: hipListings.externalId })
    .from(hipListings)
    .where(eq(hipListings.hipId, line.listing_id))
    .limit(1);
  if (mapped?.externalId) return { itemId: mapped.externalId, matchedBy: "external_id", note: "map" };

  try {
    const live = await getListing(line.listing_id);
    await upsertHipListing(live);
    const id = ebayItemIdFromHip(live);
    if (id) return { itemId: id, matchedBy: "external_id", note: "GET /listings" };
  } catch (err) {
    console.warn(`[hip ingest] GET /listings/${line.listing_id} failed: ${(err as Error).message}`);
  }

  const title = line.listing_name.trim();
  if (title) {
    const hits = await db
      .select({ itemId: ebayListings.itemId })
      .from(ebayListings)
      .where(eq(ebayListings.title, title))
      .limit(2);
    if (hits.length === 1) return { itemId: hits[0].itemId, matchedBy: "title", note: "unique title" };
    if (hits.length > 1) return { itemId: null, matchedBy: null, note: "title matches several eBay items" };
  }
  return { itemId: null, matchedBy: null, note: "no external_id on the Hip listing and no title match" };
}

// ─── Per-sale processing ─────────────────────────────────────────────────────

async function logAction(a: {
  kind: string;
  hipSaleId?: number;
  hipListingId?: number;
  itemId?: string;
  ok: boolean;
  detail: string;
}): Promise<void> {
  await db.insert(hipActions).values({
    kind: a.kind,
    hipSaleId: a.hipSaleId ?? null,
    hipListingId: a.hipListingId ?? null,
    itemId: a.itemId ?? null,
    ok: a.ok,
    detail: a.detail.slice(0, 1000),
  });
}

async function decideLine(sl: HipSaleListing): Promise<HipSaleLine> {
  const base: HipSaleLine = {
    hipListingId: sl.listing_id,
    hipSaleListingId: sl.id,
    title: sl.listing_name,
    quantity: Math.max(1, Number(sl.quantity) || 1),
    price: Number(sl.price) || 0,
    privateId: sl.private_id ?? null,
    itemId: null,
    matchedBy: null,
    decision: "manual_match",
    reason: "",
    ebayEnded: false,
  };

  const resolved = await resolveEbayItemId(sl);
  base.itemId = resolved.itemId;
  base.matchedBy = resolved.matchedBy;
  if (!resolved.itemId) {
    base.reason = resolved.note;
    return base;
  }

  const live = await getLiveItemStatus(resolved.itemId);
  switch (live.state) {
    case "unverified":
      base.decision = "unverified";
      base.reason = `eBay could not be checked: ${live.detail}`;
      return base;
    case "gone":
      base.decision = "cancel_hip";
      base.reason = `eBay listing no longer exists (${live.detail})`;
      return base;
    case "ended": {
      // Sold on eBay (or via Nifty from another venue → eBay shows sold)
      // vs ended with no sale (Hip's sync / manual end): only a real sale
      // outranks Hip.
      if (live.sold > 0 && live.sold >= live.total) {
        base.decision = "cancel_hip";
        base.reason = `already sold on eBay (${live.sold}/${live.total}, ${live.listingStatus})`;
      } else {
        base.decision = "hip_wins";
        base.reason = `eBay listing already ended without a sale (${live.listingStatus}); Nifty delist still needed`;
        base.ebayEnded = true;
        base.ebayEndDetail = "already ended";
      }
      return base;
    }
    case "active": {
      if (live.available < base.quantity) {
        base.decision = "cancel_hip";
        base.reason = `eBay shows only ${live.available} available (sold ${live.sold}/${live.total}); Hip wanted ${base.quantity}`;
        return base;
      }
      const remaining = live.available - base.quantity;
      if (remaining > 0) {
        base.decision = "manual_qty";
        base.reason = `${remaining} unit(s) remain on eBay — reduce quantity by hand (a Nifty Delist would kill them)`;
        return base;
      }
      base.decision = "hip_wins";
      base.reason = "eBay was still active — ended by API";
      return base;
    }
  }
}

function orderDecision(lines: HipSaleLine[]): HipSaleDecision {
  const set = new Set(lines.map((l) => l.decision));
  if (set.size === 1) return lines[0].decision;
  return "mixed";
}

async function processSale(sale: HipSale, result: HipIngestResult): Promise<void> {
  // Claim the sale; a duplicate (overlap window) is skipped here.
  const inserted = await db
    .insert(hipSales)
    .values({
      hipSaleId: sale.id,
      buyerUsername: sale.buyer_username ?? null,
      buyerEmail: sale.buyer_email ?? null,
      total: sale.total != null ? String(sale.total) : null,
      hipCreatedAt: sale.created_at ? new Date(sale.created_at) : null,
      decision: "processing",
    })
    .onConflictDoNothing({ target: hipSales.hipSaleId })
    .returning({ id: hipSales.hipSaleId });
  if (inserted.length === 0) return;
  result.newSales++;

  const saleLines = sale.SaleListings ?? [];
  const lines: HipSaleLine[] = [];
  for (const sl of saleLines) {
    lines.push(await decideLine(sl));
  }

  // Act on the winners: end eBay, decrement the mirror.
  for (const line of lines) {
    if (!line.itemId) continue;
    if (line.decision === "hip_wins" && !line.ebayEnded) {
      const r = await endFixedPriceItem(line.itemId, "NotAvailable");
      line.ebayEnded = r.ok;
      line.ebayEndDetail = r.detail;
      await logAction({
        kind: "end_ebay",
        hipSaleId: sale.id,
        hipListingId: line.hipListingId,
        itemId: line.itemId,
        ok: r.ok,
        detail: r.detail,
      });
      if (!r.ok) {
        line.decision = "unverified";
        line.reason = `EndFixedPriceItem failed: ${r.detail}`;
      }
    }
    if (line.decision === "hip_wins" || line.decision === "manual_qty") {
      await db
        .update(ebayListings)
        .set({
          quantity: sql`GREATEST(0, COALESCE(${ebayListings.quantity}, 0) - ${line.quantity})`,
        })
        .where(eq(ebayListings.itemId, line.itemId));
      await logAction({
        kind: "decrement_mirror",
        hipSaleId: sale.id,
        itemId: line.itemId,
        ok: true,
        detail: `-${line.quantity}`,
      });
    }
  }

  // The Hip listing itself is sold now — keep the map honest so HIP-2's
  // reconciliation doesn't try to close it later.
  for (const line of lines) {
    if (line.decision === "hip_wins" && line.hipListingId) {
      await db
        .update(hipListings)
        .set({ active: false, closed: true, lastSeenAt: new Date() })
        .where(eq(hipListings.hipId, line.hipListingId));
    }
  }

  // Queue the Nifty delist for every line Hip won (and the manual_qty
  // lines, which the extension flags rather than delists — same as TES).
  const queued = lines.filter(
    (l) => l.itemId && (l.decision === "hip_wins" || l.decision === "manual_qty")
  );
  let tesOrderId: string | null = null;
  if (queued.length > 0) {
    const skuRows = await db
      .select({ itemId: ebayListings.itemId, sku: ebayListings.sku })
      .from(ebayListings)
      .where(inArray(ebayListings.itemId, queued.map((l) => l.itemId!)));
    const skuById = new Map(skuRows.map((r) => [r.itemId, r.sku]));
    const subtotal = queued.reduce((s, l) => s + l.price * l.quantity, 0);
    const [order] = await db
      .insert(tesOrders)
      .values({
        status: "paid",
        source: "hip",
        hipSaleId: sale.id,
        email: sale.buyer_email ?? null,
        shippingName: sale.buyer_username ?? null,
        shippingAddress: sale.ShippingAddress ?? null,
        subtotal: subtotal.toFixed(2),
        shipping: (Number(sale.postage_amount) || 0).toFixed(2),
        total: (Number(sale.total) || subtotal).toFixed(2),
        governingShipClass: "hip",
        freeShipping: false,
        delistStatus: "pending",
        paidAt: sale.created_at ? new Date(sale.created_at) : new Date(),
      })
      .returning({ id: tesOrders.id });
    tesOrderId = order.id;
    await db.insert(tesOrderItems).values(
      queued.map((l) => ({
        orderId: order.id,
        itemId: l.itemId!,
        title: l.title,
        sku: skuById.get(l.itemId!) ?? l.privateId ?? null,
        unitPrice: l.price.toFixed(2),
        quantity: l.quantity,
        shipClass: "hip",
      }))
    );
  }

  const decision = orderDecision(lines.length ? lines : [{ ...emptyLine(), decision: "manual_match", reason: "sale has no listings" }]);
  const reason = lines.map((l) => `${l.title.slice(0, 60)}: ${l.decision} — ${l.reason}`).join(" | ");
  await db
    .update(hipSales)
    .set({
      decision,
      reason: reason.slice(0, 2000),
      lines,
      tesOrderId,
      processedAt: new Date(),
    })
    .where(eq(hipSales.hipSaleId, sale.id));
  result.decisions[decision] = (result.decisions[decision] ?? 0) + 1;

  await notify(sale, lines, decision);
}

function emptyLine(): HipSaleLine {
  return {
    hipListingId: 0,
    hipSaleListingId: 0,
    title: "",
    quantity: 0,
    price: 0,
    privateId: null,
    itemId: null,
    matchedBy: null,
    decision: "manual_match",
    reason: "",
    ebayEnded: false,
  };
}

async function notify(sale: HipSale, lines: HipSaleLine[], decision: HipSaleDecision): Promise<void> {
  const cfg = hipConfig();
  const needsCancel = lines.some((l) => l.decision === "cancel_hip");
  const needsHands = lines.some((l) =>
    ["manual_match", "manual_qty", "unverified"].includes(l.decision)
  );
  const headline = needsCancel
    ? "CANCEL HIP ORDER"
    : needsHands
      ? "HIP ORDER NEEDS YOU"
      : "Hip order — delist running";
  const total = sale.total != null ? `$${Number(sale.total).toFixed(2)}` : "";
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="padding:4px 8px">${l.quantity}×</td><td style="padding:4px 8px">${esc(l.title)}</td><td style="padding:4px 8px"><strong>${esc(l.decision)}</strong></td><td style="padding:4px 8px">${esc(l.reason)}</td><td style="padding:4px 8px">${
          l.itemId ? `<a href="https://www.ebay.com/itm/${esc(l.itemId)}">${esc(l.itemId)}</a>` : "—"
        }</td></tr>`
    )
    .join("");
  const orderUrl = `https://www.hippostcard.com/members/selling/sales`;
  await sendAdminEmail(
    `Hip order ${total} — ${headline}`,
    `<h2>HipPostcard sale #${sale.id} — ${esc(decision)}</h2>
<p>Buyer <strong>${esc(sale.buyer_username ?? "")}</strong> &lt;${esc(sale.buyer_email ?? "")}&gt; · ${esc(sale.created_at ?? "")}${cfg ? ` · seller ${esc(cfg.username)}` : ""}</p>
<table border="0" cellspacing="0">${rows}</table>
<p>${
      needsCancel
        ? "<strong>Cancel and refund this order on HipPostcard</strong> — the item already sold elsewhere. "
        : ""
    }${
      needsHands ? "One or more lines need a manual step (see reasons). " : ""
    }Hip winners have already been ended on eBay; the TES Actuator extension will run the Nifty delist on its next poll.</p>
<p><a href="${orderUrl}">Open the Hip order</a> · <a href="https://www.foundinalabama.com/admin/tes-orders">Delist board</a></p>`
  );
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function ingestHipSales(): Promise<HipIngestResult> {
  const result: HipIngestResult = {
    configured: hipConfigured(),
    windowFrom: null,
    windowTo: null,
    fetched: 0,
    newSales: 0,
    decisions: {},
    errors: [],
  };
  if (!result.configured) return result;

  const nowMs = Date.now();
  const cursor = await loadCursor();
  const from = new Date(nowMs - LOOKBACK_MS);
  const to = new Date(nowMs);
  result.windowFrom = from.toISOString();
  result.windowTo = to.toISOString();

  let page = 1;
  let clean = true;
  for (; page <= MAX_PAGES; page++) {
    let batch: HipSale[];
    try {
      const res = await findPaidSales({ createdFrom: from, createdTo: to, page, limit: PAGE_LIMIT });
      batch = res.results;
    } catch (err) {
      clean = false;
      result.errors.push(`page ${page}: ${(err as Error).message}`);
      break;
    }
    result.fetched += batch.length;
    for (const sale of batch) {
      try {
        await processSale(sale, result);
      } catch (err) {
        clean = false;
        const msg = (err as Error).message;
        result.errors.push(`sale ${sale.id}: ${msg}`);
        await db
          .update(hipSales)
          .set({ decision: "unverified", reason: `ingest error: ${msg}`.slice(0, 2000), processedAt: new Date() })
          .where(and(eq(hipSales.hipSaleId, sale.id), eq(hipSales.decision, "processing")));
      }
    }
    if (batch.length < PAGE_LIMIT) break;
  }

  if (clean) await saveCursor({ lastTo: to.toISOString() });
  else console.warn(`[hip ingest] not clean; last clean run ${cursor.lastTo ?? "never"}`);
  return result;
}
