// /admin/ship/invoices?ids=… — 4 × 6 invoices for the chosen packages, for
// the Zebra label printer (the Nifty Pick List's "Invoices up to here", now
// from FIA's own data). Marketplace invoices carry both brands; website
// orders carry only the shop they came from. Prices are click-to-edit.
// "Pick list order" puts the labels in the same order as the pick list.

import { loadShipOrders } from "@/lib/fulfillment/queue";
import { pickOrder } from "@/lib/fulfillment/sku";
import { InvoiceSheets, type InvoiceData } from "./InvoiceSheets";

export const dynamic = "force-dynamic";

const VENUE: Record<string, string> = {
  ebay: "eBay",
  mercari: "Mercari",
  poshmark: "Poshmark",
  depop: "Depop",
  whatnot: "Whatnot",
  hip: "HipPostcard",
  tes: "The Ephemeral State",
  fia: "Found in Alabama",
};

export default async function InvoicesPage({ searchParams }: { searchParams: { ids?: string } }) {
  const ids = (searchParams.ids ?? "").split(",").filter(Boolean);
  const orders = await loadShipOrders(ids);
  // Where each package lands on the pick list for this same selection: the
  // position of its first item when the shelves are walked. Multi-item
  // orders go where their first-picked item is.
  const walk = pickOrder(
    orders.flatMap((o) => o.lines.map((l) => ({ orderId: o.id, sku: l.binSku }))),
    (x) => x.sku
  );
  const pickRank = new Map<string, number>();
  walk.forEach((x, i) => { if (!pickRank.has(x.orderId)) pickRank.set(x.orderId, i); });
  const data: InvoiceData[] = orders.map((o) => {
    const website = o.venue === "tes" || o.venue === "fia";
    return {
      id: o.id,
      pickRank: pickRank.get(o.id) ?? Number.MAX_SAFE_INTEGER,
      brand: o.venue === "tes" ? "tes" : o.venue === "fia" ? "fia" : "both",
      venue: VENUE[o.venue] ?? o.venue,
      buyer: o.buyerUsername && !website ? `@${o.buyerUsername}` : o.buyerName,
      orderId: o.venueOrderId,
      date: o.soldAt
        ? new Date(o.soldAt.endsWith("Z") || o.soldAt.includes("+") ? o.soldAt : `${o.soldAt}Z`).toLocaleDateString("en-US", {
            timeZone: "America/Chicago",
            dateStyle: "medium",
          })
        : "",
      shipping: website ? o.shippingPaid : null,
      lines: o.lines.map((l) => ({ id: l.id, title: l.title ?? "(no title)", qty: l.quantity, price: l.price, img: l.imageUrl, sku: l.binSku })),
    };
  });
  return <InvoiceSheets invoices={data} />;
}
