// Sales dashboard — entry point for Phase 2. Right now just a redirect to
// the connect page when OAuth isn't set up; once it is, this will list
// active/scheduled/ended sales.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getOAuthStatus } from "@/lib/ebay/oauth";

export const dynamic = "force-dynamic";

export default async function SalesDashboardPage() {
  const status = await getOAuthStatus();

  if (!status.connected) {
    redirect("/admin/ebay/sales/connect");
  }

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        eBay tools · Sales
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">
        Sales &amp; promotions
      </h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Schedule percentage-off sales by store category or SKU list, run
        order discounts, or set up codeless vouchers. The list, edit, and
        report features arrive in the next round.
      </p>

      <div className="bg-white border border-dashed border-brand-ink/20 rounded-lg p-12 text-center">
        <p className="font-marker text-2xl text-brand-ink/40 mb-1">
          Sales UI coming next
        </p>
        <p className="text-sm text-brand-ink/60 max-w-md mx-auto">
          OAuth is connected. The next round adds the create-sale form for
          all four sale types, then a list/edit dashboard, then ROI
          reporting.
        </p>
      </div>

      <div className="mt-8">
        <Link
          href="/admin/ebay/sales/connect"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          Connection settings →
        </Link>
      </div>

      <div className="mt-2">
        <Link
          href="/admin/ebay"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Back to eBay tools
        </Link>
      </div>
    </section>
  );
}
