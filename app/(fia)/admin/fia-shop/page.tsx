// /admin/fia-shop — settings + readiness for buying direct on
// foundinalabama.com (Phase FIA-SHOP-1): the FIA discount, the
// weight-based shipping settings, and how much of the in-stock inventory
// has an eBay package weight (items without one ship at the class
// fallback weight, which may under- or over-charge).

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings } from "@/db/schema";
import { getFiaDiscountPercent, getFiaShipSettings } from "@/lib/fia/settings";
import { DEFAULT_FIA_SHIP_SETTINGS } from "@/lib/fia/shipping";
import FiaShopEditor from "./FiaShopEditor";

export const dynamic = "force-dynamic";

export default async function FiaShopAdminPage() {
  const [percent, settings] = await Promise.all([
    getFiaDiscountPercent(),
    getFiaShipSettings(),
  ]);

  const [cov] = await db
    .select({
      inStock: sql<number>`count(*)`,
      withWeight: sql<number>`count(*) filter (where ${ebayListings.pkgWeightOz} is not null)`,
      withDims: sql<number>`count(*) filter (where ${ebayListings.pkgLengthIn} is not null and ${ebayListings.pkgWidthIn} is not null and ${ebayListings.pkgDepthIn} is not null)`,
      media: sql<number>`count(*) filter (where ${ebayListings.shippingServices}::text ilike '%media%')`,
      tooHeavy: sql<number>`count(*) filter (where ${ebayListings.pkgWeightOz} > ${settings.maxItemWeightOz})`,
      tooBig: sql<number>`count(*) filter (where greatest(coalesce(${ebayListings.pkgLengthIn},0), coalesce(${ebayListings.pkgWidthIn},0), coalesce(${ebayListings.pkgDepthIn},0)) > ${settings.maxItemSideIn})`,
    })
    .from(ebayListings)
    .where(sql`coalesce(${ebayListings.quantity}, 0) > 0`);

  const n = (v: unknown) => Number(v ?? 0);
  const inStock = n(cov?.inStock);
  const pct = (v: number) => (inStock > 0 ? `${Math.round((v / inStock) * 100)}%` : "—");

  const stats = [
    { label: "In stock", value: inStock.toLocaleString(), note: "" },
    {
      label: "Have an eBay weight",
      value: n(cov?.withWeight).toLocaleString(),
      note: pct(n(cov?.withWeight)),
    },
    {
      label: "Have dimensions",
      value: n(cov?.withDims).toLocaleString(),
      note: pct(n(cov?.withDims)),
    },
    {
      label: "Ship Media Mail on eBay",
      value: n(cov?.media).toLocaleString(),
      note: pct(n(cov?.media)),
    },
    {
      label: "eBay-only: too heavy",
      value: n(cov?.tooHeavy).toLocaleString(),
      note: `> ${settings.maxItemWeightOz / 16} lb`,
    },
    {
      label: "eBay-only: too big",
      value: n(cov?.tooBig).toLocaleString(),
      note: `> ${settings.maxItemSideIn} in`,
    },
  ];

  return (
    <section className="container-content py-12 space-y-8">
      <div>
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
          Found in Alabama
        </p>
        <h1 className="font-marker text-3xl md:text-4xl mb-3">Direct sales</h1>
        <p className="text-brand-ink/70 max-w-prose">
          Pricing and shipping for buying on foundinalabama.com. Orders land on
          the <a href="/admin/tes-orders" className="underline">orders board</a>{" "}
          with an FIA badge and go through the same delist queue and Pirate
          Ship export as TES.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-3xl">
        {stats.map((s) => (
          <div key={s.label} className="bg-white border border-brand-ink/15 rounded-lg p-4">
            <p className="text-xs text-brand-ink/60">{s.label}</p>
            <p className="text-2xl font-medium tabular-nums">{s.value}</p>
            {s.note && <p className="text-xs text-brand-ink/50">{s.note}</p>}
          </div>
        ))}
      </div>
      <p className="text-xs text-brand-ink/50 max-w-prose -mt-4">
        Weights and dimensions come from each eBay listing&rsquo;s package
        details and fill in on the next daily full sweep after deploy.
      </p>

      <FiaShopEditor
        initialPercent={percent}
        initialSettings={settings}
        defaults={DEFAULT_FIA_SHIP_SETTINGS}
      />
    </section>
  );
}
