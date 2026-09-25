// POST /api/admin/tes-orders/tracking-import
// Body: { csv: string } — Pirate Ship's shipment export (Phase SHIP-1).
//
// Matches each label to a TES order — by the Order ID column we sent out
// (tes_orders.id), falling back to recipient name + ZIP among unshipped
// orders when the export has no Order ID — and records tracking, carrier
// and shipped_at. Never overwrites an existing tracking number; voided /
// refunded labels are skipped. Rows that aren't TES orders (eBay labels,
// one-offs) are simply reported as unmatched. Admin-session gated.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { tesOrders } from "@/db/schema";
import { extractTracking, normName, type TrackingRow } from "@/lib/tes/pirate-ship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5_000_000;

type Addr = { postal_code?: string | null } | null;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let csv = "";
  try {
    const body = (await req.json()) as { csv?: unknown };
    csv = typeof body.csv === "string" ? body.csv : "";
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON { csv }" }, { status: 400 });
  }
  if (!csv || csv.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "Empty or oversized file" }, { status: 400 });
  }

  const parsed = extractTracking(csv);
  if (!parsed.ok) return NextResponse.json(parsed, { status: 422 });

  // Orders referenced by id.
  const byIdRows = parsed.rows.filter((r) => r.orderId);
  const ids = Array.from(new Set(byIdRows.map((r) => r.orderId as string)));
  const known = ids.length
    ? await db
        .select({ id: tesOrders.id, trackingNumber: tesOrders.trackingNumber })
        .from(tesOrders)
        .where(and(inArray(tesOrders.id, ids), eq(tesOrders.source, "tes")))
    : [];
  const knownById = new Map(known.map((k) => [k.id, k]));

  // Fallback pool: paid, unshipped TES orders, keyed by name + ZIP.
  const needFallback = parsed.rows.some((r) => !r.orderId && r.name && r.zip5);
  const pool = needFallback
    ? await db
        .select({
          id: tesOrders.id,
          shippingName: tesOrders.shippingName,
          shippingAddress: tesOrders.shippingAddress,
        })
        .from(tesOrders)
        .where(
          and(eq(tesOrders.source, "tes"), eq(tesOrders.status, "paid"), isNull(tesOrders.shippedAt))
        )
    : [];
  const poolByKey = new Map<string, string[]>();
  for (const p of pool) {
    const zip = ((p.shippingAddress as Addr)?.postal_code ?? "").match(/\d{5}/)?.[0];
    if (!zip) continue;
    const key = `${normName(p.shippingName)}|${zip}`;
    poolByKey.set(key, [...(poolByKey.get(key) ?? []), p.id]);
  }

  const recorded: { orderId: string; tracking: string; line: number }[] = [];
  const alreadyHad: { orderId: string; tracking: string; line: number }[] = [];
  const unmatched: { line: number; tracking: string; reason: string }[] = [];
  const claimed = new Set<string>();

  async function record(orderId: string, row: TrackingRow): Promise<boolean> {
    const updated = await db
      .update(tesOrders)
      .set({ trackingNumber: row.tracking, carrier: row.carrier, shippedAt: new Date() })
      .where(
        and(eq(tesOrders.id, orderId), isNull(tesOrders.trackingNumber), isNull(tesOrders.shippedAt))
      )
      .returning({ id: tesOrders.id });
    return updated.length > 0;
  }

  for (const row of parsed.rows) {
    if (row.orderId) {
      const k = knownById.get(row.orderId);
      if (!k) {
        unmatched.push({ line: row.line, tracking: row.tracking, reason: "Order ID isn't a TES order" });
      } else if (k.trackingNumber || claimed.has(k.id)) {
        alreadyHad.push({ orderId: k.id, tracking: k.trackingNumber ?? row.tracking, line: row.line });
      } else if (await record(k.id, row)) {
        claimed.add(k.id);
        recorded.push({ orderId: k.id, tracking: row.tracking, line: row.line });
      } else {
        alreadyHad.push({ orderId: k.id, tracking: row.tracking, line: row.line });
      }
      continue;
    }
    if (!row.name || !row.zip5) {
      unmatched.push({ line: row.line, tracking: row.tracking, reason: "No Order ID, name or ZIP to match on" });
      continue;
    }
    const cands = (poolByKey.get(`${normName(row.name)}|${row.zip5}`) ?? []).filter(
      (id) => !claimed.has(id)
    );
    if (cands.length !== 1) {
      unmatched.push({
        line: row.line,
        tracking: row.tracking,
        reason: cands.length === 0 ? "Not a TES order (no name + ZIP match)" : "Several open orders share this name + ZIP — record by hand",
      });
      continue;
    }
    if (await record(cands[0], row)) {
      claimed.add(cands[0]);
      recorded.push({ orderId: cands[0], tracking: row.tracking, line: row.line });
    } else {
      alreadyHad.push({ orderId: cands[0], tracking: row.tracking, line: row.line });
    }
  }

  return NextResponse.json({
    ok: true,
    recorded,
    alreadyHad,
    unmatched,
    voidedSkipped: parsed.voidedSkipped,
  });
}
