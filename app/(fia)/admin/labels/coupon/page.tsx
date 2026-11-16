// /admin/labels/coupon?ship=<package id>,… — the package's invoice coupon
// code on a DYMO label (11354, 57 × 32 mm), no QR code (COUPON-4). Same code
// as the 4 × 6 invoice (made here if the invoice hasn't been shown yet), for
// when the code doesn't fit on the invoice, or to drop in any package.

import { loadShipOrders } from "@/lib/fulfillment/queue";
import { alabamaOrderIds } from "@/lib/shop/alabama";
import { codesForOrders } from "@/lib/shop/coupons";
import { planInvoicePitches } from "@/lib/shop/invoice-plan";
import { CouponSheets, type CouponLabel } from "./CouponSheets";

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

export default async function CouponLabelPage({ searchParams }: { searchParams: { ship?: string } }) {
  const ids = (searchParams.ship ?? "").split(",").filter(Boolean).slice(0, 100);
  const orders = await loadShipOrders(ids);
  const alabama = await alabamaOrderIds(orders.map((o) => o.id)).catch(() => new Set<string>());
  const { picked } = await planInvoicePitches(orders, alabama);
  const codes = await codesForOrders(orders.map((o) => ({ id: o.id, venue: o.venue, site: picked.get(o.id)!.site }))).catch((err) => {
    console.error("[coupon labels] codes failed", err);
    return new Map();
  });
  const labels: CouponLabel[] = orders.map((o) => {
    const c = codes.get(o.id);
    const website = o.venue === "tes" || o.venue === "fia";
    return {
      key: o.id,
      who: [o.buyerUsername && !website ? `@${o.buyerUsername}` : o.buyerName, VENUE[o.venue] ?? o.venue].filter(Boolean).join(" · "),
      alabama: alabama.has(o.id),
      coupon: c
        ? {
            code: c.code,
            percent: c.percent,
            site: c.site ?? picked.get(o.id)?.site ?? "fia",
            expires: new Date(c.expiresAt).toLocaleDateString("en-US", { timeZone: "America/Chicago", dateStyle: "medium" }),
          }
        : null,
    };
  });
  return <CouponSheets labels={labels} />;
}
