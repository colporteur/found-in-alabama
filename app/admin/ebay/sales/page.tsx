// Sales dashboard — lists all sales we've cached locally with their eBay
// status. Click into a row for details + edit/end actions (built in 2D).

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { ebaySales } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getOAuthStatus } from "@/lib/ebay/oauth";
import SaleTiersPanel from "@/components/SaleTiersPanel";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<
  string,
  { label: string; cls: string }
> = {
  DRAFT: { label: "Draft", cls: "bg-brand-ink/10 text-brand-ink/70" },
  SCHEDULED: { label: "Scheduled", cls: "bg-brand-yellow/30 text-brand-ink" },
  RUNNING: { label: "Running", cls: "bg-emerald-100 text-emerald-900" },
  PAUSED: { label: "Paused", cls: "bg-brand-paper text-brand-ink/70 border border-brand-ink/15" },
  ENDED: { label: "Ended", cls: "bg-brand-ink/10 text-brand-ink/60" },
  FAILED: { label: "Failed", cls: "bg-red-100 text-red-900" },
};

export default async function SalesDashboardPage() {
  const status = await getOAuthStatus();

  if (!status.connected) {
    redirect("/admin/ebay/sales/connect");
  }

  const sales = await db
    .select()
    .from(ebaySales)
    .orderBy(desc(ebaySales.createdAt))
    .limit(50);

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            eBay tools · Sales
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">
            Sales &amp; promotions
          </h1>
        </div>
        <Link
          href="/admin/ebay/sales/new"
          className="bg-brand-ink text-brand-paper text-sm px-4 py-2 rounded hover:bg-brand-ink/90"
        >
          New sale
        </Link>
      </div>
      <p className="text-brand-ink/70 mb-4 max-w-prose">
        Schedule percentage-off sales by store category.
      </p>

      <p className="text-sm text-brand-ink/60 mb-8 max-w-prose">
        Manual sales are created as <strong>drafts</strong> on eBay — review
        and activate them in{" "}
        <a
          href="https://www.ebay.com/sh/marketing"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-brand-yellow decoration-2 underline-offset-2"
        >
          Seller Hub → Marketing → Discounts
        </a>
        . Automatic tier sales below go live on their own.
      </p>

      <SaleTiersPanel />

      {sales.length === 0 ? (
        <div className="bg-white border border-dashed border-brand-ink/20 rounded-lg p-12 text-center">
          <p className="font-marker text-2xl text-brand-ink/40 mb-1">
            No sales yet.
          </p>
          <p className="text-sm text-brand-ink/60 max-w-md mx-auto mb-4">
            Click &ldquo;New sale&rdquo; to schedule your first markdown.
          </p>
          <Link
            href="/admin/ebay/sales/new"
            className="inline-block bg-brand-ink text-brand-paper text-sm px-4 py-2 rounded hover:bg-brand-ink/90"
          >
            Create one →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-brand-ink/15 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-brand-paper border-b border-brand-ink/10 text-xs uppercase tracking-wider text-brand-ink/60">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium text-right">% off</th>
                <th className="px-4 py-3 font-medium">Window</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const tone = STATUS_TONE[s.status] ?? {
                  label: s.status,
                  cls: "bg-brand-ink/10 text-brand-ink/60",
                };
                return (
                  <tr
                    key={s.id}
                    className="border-b border-brand-ink/5 last:border-b-0"
                  >
                    <td className="px-4 py-3 max-w-md">
                      <div className="font-medium truncate" title={s.name}>
                        {s.name}
                      </div>
                      {s.lastError && (
                        <div className="text-xs text-red-700 truncate" title={s.lastError}>
                          {s.lastError}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-brand-ink/70">
                      {s.saleType.replace(/_/g, " ").toLowerCase()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {s.discountPercent ? `${s.discountPercent}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-brand-ink/60 text-xs">
                      {s.startsAt.toLocaleDateString()} –{" "}
                      {s.endsAt.toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs uppercase tracking-wider px-2 py-1 rounded ${tone.cls}`}
                      >
                        {tone.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-6 text-sm">
        <Link
          href="/admin/ebay/sales/connect"
          className="text-brand-ink/60 hover:text-brand-ink"
        >
          Connection settings →
        </Link>
        <Link
          href="/admin/ebay"
          className="text-brand-ink/60 hover:text-brand-ink"
        >
          ← Back to eBay tools
        </Link>
      </div>
    </section>
  );
}
