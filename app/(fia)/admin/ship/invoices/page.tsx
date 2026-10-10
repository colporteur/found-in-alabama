// /admin/ship/invoices?ids=… — 4 × 6 invoices for the chosen packages, for
// the Zebra label printer (the Nifty Pick List's "Invoices up to here", now
// from FIA's own data). Marketplace invoices carry both brands; website
// orders carry only the shop they came from. Prices are click-to-edit.

import { loadShipOrders } from "@/lib/fulfillment/queue";
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
  const data: InvoiceData[] = orders.map((o) => {
    const website = o.venue === "tes" || o.venue === "fia";
    return {
      id: o.id,
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
      lines: o.lines.map((l) => ({ id: l.id, title: l.title ?? "(no title)", qty: l.quantity, price: l.price, img: l.imageUrl })),
    };
  });
  return <InvoiceSheets invoices={data} />;
}
