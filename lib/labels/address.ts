// Address labels for the DYMO (stock 11354, 57 × 32 mm — the same printer
// setup as the item labels): the buyer's name and mailing address for a
// website order (TES orders page) or any package on the ship page.

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AddressLabel = { key: string; lines: string[] };

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Pure: label lines from a stored address — Stripe's shape (postal_code),
 *  eBay's (postalCode, name), or a plain { text } block from a buyer email. */
export function addressLines(name: string | null | undefined, addr: unknown): string[] {
  const a = (addr && typeof addr === "object" ? addr : {}) as Record<string, unknown>;
  const who = s(name) || s(a.name);
  if (s(a.text)) {
    const body = s(a.text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return who && body[0]?.toLowerCase() !== who.toLowerCase() ? [who, ...body] : body;
  }
  const zip = s(a.postal_code) || s(a.postalCode);
  const cityLine = [s(a.city), [s(a.state), zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const country = s(a.country);
  const lines = [who, s(a.line1), s(a.line2), cityLine, country && !/^(us|usa|united states)$/i.test(country) ? country : ""];
  return lines.filter(Boolean).map((l) => l.toUpperCase());
}

/** Labels for website orders (tes_orders ids) and ship-page packages (ship_orders ids). */
export async function addressLabels(tesIds: string[], shipIds: string[]): Promise<AddressLabel[]> {
  const out: AddressLabel[] = [];
  const tes = tesIds.filter((id) => UUID.test(id)).slice(0, 100);
  if (tes.length) {
    const found = await rows(sql`
      SELECT id, shipping_name, shipping_address FROM tes_orders
      WHERE id IN (${sql.join(tes.map((id) => sql`${id}::uuid`), sql`, `)})`);
    const byId = new Map(found.map((r) => [String(r.id), r]));
    for (const id of tes) {
      const r = byId.get(id);
      if (r) out.push({ key: `t:${id}`, lines: addressLines(r.shipping_name as string | null, r.shipping_address) });
    }
  }
  const ship = shipIds.filter((id) => UUID.test(id)).slice(0, 100);
  if (ship.length) {
    // A website / Hip package keeps its address on the website order.
    const found = await rows(sql`
      SELECT o.id, o.buyer_name, o.ship_to, t.shipping_name, t.shipping_address
      FROM ship_orders o
      LEFT JOIN tes_orders t ON t.id::text = CASE
        WHEN o.order_key LIKE 'stripe:%' THEN substr(o.order_key, 8)
        WHEN o.order_key LIKE 'hip:%' THEN (SELECT h.tes_order_id::text FROM hip_sales h WHERE h.hip_sale_id::text = substr(o.order_key, 5))
      END
      WHERE o.id IN (${sql.join(ship.map((id) => sql`${id}::uuid`), sql`, `)})`);
    const byId = new Map(found.map((r) => [String(r.id), r]));
    for (const id of ship) {
      const r = byId.get(id);
      if (!r) continue;
      const lines = r.ship_to
        ? addressLines(r.buyer_name as string | null, r.ship_to)
        : addressLines((r.shipping_name as string | null) ?? (r.buyer_name as string | null), r.shipping_address);
      out.push({ key: `s:${id}`, lines });
    }
  }
  return out;
}
