// Website / Hip orders on the to-ship queue (/admin/ship): what each package
// needs beyond its ship_orders row — the delist toggle ("Mark delisted in
// Nifty", the same flag as /admin/tes-orders) and, for orders we hold the
// address for (TES / FIA), a single-label handoff to Pirate Ship.
//
// Read-only. A package is tied to its tes_orders rows through its lines'
// sale events, so a combined package lists every order inside it.

import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { tesOrderItems, ebayListings } from "@/db/schema";
import { estimatePackage, SHIPPABLE_SOURCES } from "@/lib/tes/pirate-ship";
import { serviceShortLabel } from "@/lib/fia/shipping";

/** What the Label Combiner extension fills on Pirate Ship's single-label form. */
export type PiratePackage = {
  /** "SoftEnvelope" (length × width) or "Parcel" (length × width × height). */
  packageType: "SoftEnvelope" | "Parcel";
  length: string;
  width: string;
  height: string | null;
  pounds: string;
  ounces: string;
  mediaMail: boolean;
};

export type WebOrderExtra = {
  tesOrderId: string;
  /** "tes" | "fia" | "hip" */
  source: string;
  delistDone: boolean;
  /** null when we don't hold the address (Hip) or it already shipped. */
  pirate: {
    address: string;
    /** e.g. "Media Mail · 1 lb 0 oz · envelope 12 × 9" */
    summary: string;
    package: PiratePackage;
  } | null;
};

type Row = Record<string, unknown>;
type Addr = { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null };

const num = (n: number) => String(Math.round(n * 100) / 100);

export async function webOrderExtras(shipOrderIds: string[]): Promise<Record<string, WebOrderExtra[]>> {
  const clean = shipOrderIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500);
  if (!clean.length) return {};
  const res = (await db.execute(sql`
    SELECT DISTINCT l.order_id AS ship_id, t.id AS tes_id, t.source, t.delist_status, t.shipping_name,
           t.shipping_address, t.shipped_at, t.ship_service, t.package_weight_oz, t.created_at
    FROM ship_order_lines l
    JOIN sale_events e ON e.id = l.sale_event_id
    JOIN tes_orders t ON t.id::text = CASE
           WHEN e.source = 'stripe' THEN e.order_ref
           WHEN e.source = 'hip' THEN (SELECT h.tes_order_id::text FROM hip_sales h WHERE h.hip_sale_id::text = e.source_ref)
         END
    WHERE l.order_id = ANY(${`{${clean.join(",")}}`}::uuid[]) AND t.status = 'paid'
    ORDER BY t.created_at`)) as { rows?: Row[] };
  const list = res.rows ?? [];
  if (!list.length) return {};

  const tesIds = Array.from(new Set(list.map((r) => String(r.tes_id))));
  const items = await db
    .select({
      orderId: tesOrderItems.orderId,
      quantity: tesOrderItems.quantity,
      shipClass: tesOrderItems.shipClass,
      itemId: tesOrderItems.itemId,
    })
    .from(tesOrderItems)
    .where(inArray(tesOrderItems.orderId, tesIds));
  // A single-unit order ships in the eBay listing's own box size when FIA
  // knows it (same rule as the Pirate Ship spreadsheet).
  const itemIds = Array.from(new Set(items.map((i) => i.itemId)));
  const dims = itemIds.length
    ? await db
        .select({ itemId: ebayListings.itemId, l: ebayListings.pkgLengthIn, w: ebayListings.pkgWidthIn, d: ebayListings.pkgDepthIn })
        .from(ebayListings)
        .where(inArray(ebayListings.itemId, itemIds))
    : [];
  const dimsById = new Map(dims.map((r) => [r.itemId, r]));

  const out: Record<string, WebOrderExtra[]> = {};
  for (const r of list) {
    const tesId = String(r.tes_id);
    const source = String(r.source);
    let pirate: WebOrderExtra["pirate"] = null;
    const rawAddr = typeof r.shipping_address === "string" ? safeJson(r.shipping_address) : r.shipping_address;
    const a = (rawAddr ?? null) as Addr | null;
    if (SHIPPABLE_SOURCES.includes(source) && a?.line1 && !r.shipped_at) {
      const its = items.filter((i) => i.orderId === tesId);
      const est = estimatePackage(its);
      const units = its.reduce((n, i) => n + Math.max(1, i.quantity), 0);
      const one = units === 1 ? dimsById.get(its[0].itemId) : undefined;
      const box = one && one.l && one.w && one.d ? { lengthIn: Number(one.l), widthIn: Number(one.w), heightIn: Number(one.d) } : null;
      const quoted = r.package_weight_oz != null ? Number(r.package_weight_oz) : 0;
      const weightOz = quoted > 0 ? quoted : est.weightOz;
      const mediaMail = source === "fia" ? r.ship_service === "media" : est.shipClass === "media";
      // Books with no known box go in the usual 12 × 9 envelope (the eBay
      // handoff's default); anything flat is an envelope; the rest is a box.
      const size = box ?? (est.shipClass === "media" ? { lengthIn: 12, widthIn: 9, heightIn: 0 } : est);
      const envelope = size.heightIn < 1;
      const whole = Math.ceil(weightOz);
      const pkg: PiratePackage = {
        packageType: envelope ? "SoftEnvelope" : "Parcel",
        length: num(size.lengthIn),
        width: num(size.widthIn),
        height: envelope ? null : num(size.heightIn),
        pounds: String(Math.floor(whole / 16)),
        ounces: String(whole % 16),
        mediaMail,
      };
      const service = source === "fia" ? serviceShortLabel(r.ship_service as string | null) : mediaMail ? "Media Mail" : `${est.shipClass} class`;
      const address = [
        String(r.shipping_name ?? "").trim(),
        a.line1,
        a.line2,
        `${a.city ?? ""}, ${a.state ?? ""} ${a.postal_code ?? ""}`.trim(),
      ]
        .map((s) => String(s ?? "").trim())
        .filter(Boolean)
        .join("\n");
      pirate = {
        address,
        summary: `${service} · ${pkg.pounds} lb ${pkg.ounces} oz · ${envelope ? "envelope" : "box"} ${pkg.length} × ${pkg.width}${pkg.height ? ` × ${pkg.height}` : ""}`,
        package: pkg,
      };
    }
    const shipId = String(r.ship_id);
    (out[shipId] ??= []).push({ tesOrderId: tesId, source, delistDone: r.delist_status === "done", pirate });
  }
  return out;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
