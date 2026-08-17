// /admin/tes-orders — The Ephemeral State orders list. Doubles as the
// manual delist portal (phase-3 v1): each paid order shows its items
// with eBay links; Todd delists them in Nifty ("delist everywhere"),
// then clicks "Mark handled". The Chrome-extension actuator will later
// automate exactly this list.

import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tesOrders, tesOrderItems } from "@/db/schema";
import MarkHandledButton from "./MarkHandledButton";

export const dynamic = "force-dynamic";

type Addr = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
} | null;

export default async function TesOrdersPage() {
  const orders = await db
    .select()
    .from(tesOrders)
    .orderBy(desc(tesOrders.createdAt))
    .limit(100);
  const orderIds = orders.map((o) => o.id);
  const items = orderIds.length
    ? await db
        .select()
        .from(tesOrderItems)
        .where(inArray(tesOrderItems.orderId, orderIds))
    : [];
  const itemsByOrder = new Map<string, typeof items>();
  for (const it of items) {
    const arr = itemsByOrder.get(it.orderId) ?? [];
    arr.push(it);
    itemsByOrder.set(it.orderId, arr);
  }

  const needsDelist = orders.filter(
    (o) => o.status === "paid" && o.delistStatus === "pending"
  ).length;

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        The Ephemeral State
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">Orders</h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        {needsDelist > 0 ? (
          <>
            <strong className="text-red-700">
              {needsDelist} paid {needsDelist === 1 ? "order needs" : "orders need"} delisting
            </strong>{" "}
            — open each item in Nifty, delist everywhere, then mark the order
            handled.
          </>
        ) : (
          "Nothing waiting on a delist. Paid orders appear here with packing details."
        )}
      </p>

      {orders.length === 0 ? (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-12 text-center text-brand-ink/50">
          No orders yet.
        </div>
      ) : (
        <ul className="space-y-4">
          {orders.map((o) => {
            const addr = o.shippingAddress as Addr;
            const lines = itemsByOrder.get(o.id) ?? [];
            return (
              <li
                key={o.id}
                className={`bg-white border rounded-lg p-5 ${
                  o.status === "paid" && o.delistStatus === "pending"
                    ? "border-red-300"
                    : "border-brand-ink/15"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <p className="font-medium">
                    {o.shippingName ?? "(name pending)"}{" "}
                    <span className="text-brand-ink/50 font-normal">
                      {o.email ?? ""}
                    </span>
                  </p>
                  <p className="text-sm text-brand-ink/60">
                    {o.createdAt.toLocaleString()} ·{" "}
                    <span
                      className={
                        o.status === "paid"
                          ? "text-green-700 font-medium"
                          : o.status === "canceled"
                          ? "text-brand-ink/40"
                          : "text-amber-700"
                      }
                    >
                      {o.status}
                    </span>
                  </p>
                </div>
                {addr && (
                  <p className="text-sm text-brand-ink/70 mb-3">
                    {[addr.line1, addr.line2].filter(Boolean).join(", ")} ·{" "}
                    {addr.city}, {addr.state} {addr.postal_code}
                  </p>
                )}
                <ul className="text-sm divide-y divide-brand-ink/5 border-t border-b border-brand-ink/10 mb-3">
                  {lines.map((it) => (
                    <li key={it.id} className="py-1.5 flex items-center gap-3">
                      <span className="text-brand-ink/50 w-8">
                        {it.quantity}×
                      </span>
                      <span className="flex-1 truncate">{it.title}</span>
                      <span className="text-brand-ink/50">{it.sku ?? ""}</span>
                      <span className="text-brand-ink/50">{it.shipClass}</span>
                      <span className="tabular-nums">${it.unitPrice}</span>
                      <a
                        href={`https://www.ebay.com/itm/${it.itemId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-earth hover:underline"
                      >
                        eBay ↗
                      </a>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm">
                    Subtotal ${o.subtotal} · Shipping ${o.shipping}
                    {o.freeShipping ? " (free)" : ""} ·{" "}
                    <strong>Total ${o.total}</strong> ·{" "}
                    <span className="text-brand-ink/50">
                      {o.governingShipClass}
                    </span>
                  </p>
                  {o.status === "paid" && (
                    <MarkHandledButton
                      orderId={o.id}
                      handled={o.delistStatus === "done"}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-10">
        <Link
          href="/admin"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Back to admin
        </Link>
      </div>
    </section>
  );
}
