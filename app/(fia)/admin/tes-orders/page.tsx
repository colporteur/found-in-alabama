// /admin/tes-orders — the Delist board. Started as The Ephemeral State
// orders list / manual delist portal; since Phase HIP-1 it also carries
// HipPostcard sales (tes_orders.source = "hip") and, at the top, the Hip
// decisions that need Todd's hands: CANCEL HIP ORDER (the item already
// sold elsewhere — Hip is the lowest-priority venue), unmatched lines,
// multi-quantity lines, and eBay-unverified lines. The TES Actuator
// extension works the paid/pending rows automatically; this page is
// where the leftovers land.

import Link from "next/link";
import { desc, eq, inArray, isNull, notInArray, and } from "drizzle-orm";
import { db } from "@/db";
import { tesOrders, tesOrderItems, hipSales } from "@/db/schema";
import type { HipSaleLine } from "@/lib/hip/ingest";
import MarkHandledButton from "./MarkHandledButton";
import HipHandledButton from "./HipHandledButton";

const HIP_AUTO_DECISIONS = ["hip_wins", "processing"];

function hipLabel(decision: string): { text: string; cls: string; action: string } {
  switch (decision) {
    case "cancel_hip":
      return { text: "CANCEL HIP ORDER", cls: "bg-red-700 text-white", action: "Canceled on Hip" };
    case "manual_match":
      return { text: "NO eBay MATCH", cls: "bg-amber-600 text-white", action: "Handled by hand" };
    case "manual_qty":
      return { text: "MULTI-QTY — reduce by hand", cls: "bg-amber-600 text-white", action: "Quantity reduced" };
    case "unverified":
      return { text: "eBay UNVERIFIED", cls: "bg-amber-600 text-white", action: "Checked by hand" };
    case "mixed":
      return { text: "MIXED — see lines", cls: "bg-red-700 text-white", action: "All lines handled" };
    default:
      return { text: decision, cls: "bg-brand-ink/10 text-brand-ink", action: "Handled" };
  }
}

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

  // Hip decisions that need a human — newest first, unhandled only.
  const hipNeedsYou = await db
    .select()
    .from(hipSales)
    .where(and(isNull(hipSales.handledAt), notInArray(hipSales.decision, HIP_AUTO_DECISIONS)))
    .orderBy(desc(hipSales.createdAt))
    .limit(50);

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

      {hipNeedsYou.length > 0 && (
        <div className="mb-10">
          <h2 className="font-medium text-lg mb-1">
            <span className="text-red-700">{hipNeedsYou.length}</span> HipPostcard{" "}
            {hipNeedsYou.length === 1 ? "sale needs" : "sales need"} you
          </h2>
          <p className="text-sm text-brand-ink/60 mb-3 max-w-prose">
            Hip is the lowest-priority venue: when the item already sold
            elsewhere, cancel and refund the Hip order. Other flags are lines
            the automation would not touch on its own.
          </p>
          <ul className="space-y-3">
            {hipNeedsYou.map((h) => {
              const lbl = hipLabel(h.decision);
              const lines = (Array.isArray(h.lines) ? h.lines : []) as HipSaleLine[];
              return (
                <li key={h.hipSaleId} className="bg-white border border-red-300 rounded-lg p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                    <p className="font-medium">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded mr-2 ${lbl.cls}`}>
                        {lbl.text}
                      </span>
                      Hip sale #{h.hipSaleId} · {h.buyerUsername ?? "(buyer)"}{" "}
                      <span className="text-brand-ink/50 font-normal">{h.buyerEmail ?? ""}</span>
                    </p>
                    <p className="text-sm text-brand-ink/60">
                      {(h.hipCreatedAt ?? h.createdAt).toLocaleString()}
                      {h.total ? ` · $${h.total}` : ""}
                    </p>
                  </div>
                  <ul className="text-sm divide-y divide-brand-ink/5 border-t border-b border-brand-ink/10 mb-3">
                    {lines.map((l) => (
                      <li key={l.hipSaleListingId} className="py-1.5 flex flex-wrap items-center gap-3">
                        <span className="text-brand-ink/50 w-8">{l.quantity}×</span>
                        <span className="flex-1 min-w-[12rem] truncate">{l.title}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${hipLabel(l.decision).cls}`}>
                          {l.decision}
                        </span>
                        <span className="text-brand-ink/60 basis-full md:basis-auto">{l.reason}</span>
                        {l.itemId && (
                          <a
                            href={`https://www.ebay.com/itm/${l.itemId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-earth hover:underline"
                          >
                            eBay ↗
                          </a>
                        )}
                        <a
                          href={`https://app.nifty.ai/inventory?query=${encodeURIComponent(l.title)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-earth hover:underline"
                        >
                          Nifty ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <a
                      href="https://www.hippostcard.com/members/selling/sales"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-brand-earth hover:underline"
                    >
                      Open Hip orders ↗
                    </a>
                    <HipHandledButton hipSaleId={h.hipSaleId} handled={!!h.handledAt} label={lbl.action} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
                    {o.source === "hip" && (
                      <span className="inline-block text-xs px-2 py-0.5 rounded mr-2 bg-sky-700 text-white">
                        HIP #{o.hipSaleId}
                      </span>
                    )}
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
