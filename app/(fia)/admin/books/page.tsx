// /admin/books?month=YYYY-MM — profit per sale (Phase 4e): revenue, venue
// fees (real for eBay orders, estimated elsewhere), postage, item cost
// (from the item or its haul) and profit, with a CSV for tax time.

import Link from "next/link";
import { booksReady, monthReport } from "@/lib/books/books";
import { PostageInput } from "./BooksControls";

export const dynamic = "force-dynamic";

const VENUE: Record<string, string> = {
  ebay: "eBay",
  mercari: "Mercari",
  poshmark: "Poshmark",
  depop: "Depop",
  whatnot: "Whatnot",
  hip: "Hip",
  tes: "TES",
  fia: "FIA",
};
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;

function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function BooksPage({ searchParams }: { searchParams: { month?: string } }) {
  if (!(await booksReady())) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">Books</h1>
        <p className="text-brand-ink/80">
          The books tables don&apos;t exist yet. Run the migration (<code>npm run db:migrate</code>).
        </p>
      </section>
    );
  }
  const now = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? searchParams.month! : now;
  const r = await monthReport(month);
  const t = r.totals;
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Books</p>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="font-marker text-4xl md:text-5xl">Profit · {label}</h1>
          <p className="text-sm text-brand-ink/60 mt-2 max-w-2xl">
            Every package from the to-ship queue. eBay fees are eBay&apos;s own; other venues&apos; fees are estimates
            (edit the rates in settings). Postage is $0 where the buyer pays the label; type it in for the rest. Item
            cost comes from the item or its haul.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={`/admin/books?month=${shiftMonth(month, -1)}`} className="px-3 py-2 rounded border border-brand-ink/20">
            ← {shiftMonth(month, -1)}
          </Link>
          {month < now && (
            <Link href={`/admin/books?month=${shiftMonth(month, 1)}`} className="px-3 py-2 rounded border border-brand-ink/20">
              {shiftMonth(month, 1)} →
            </Link>
          )}
          <a href={`/api/admin/books/csv?month=${month}`} className="px-3 py-2 rounded border border-brand-ink/20">
            Download CSV
          </a>
          <Link href="/admin/books/hauls" className="px-3 py-2 rounded border border-brand-ink/20">
            Hauls
          </Link>
          <Link href="/admin/books/settings" className="px-3 py-2 rounded border border-brand-ink/20">
            Fee rates
          </Link>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-6 mb-8">
        {[
          ["Sales", String(t.orders)],
          ["Revenue", money(t.revenue)],
          ["Fees", money(t.fees)],
          ["Postage", money(t.shipping)],
          ["Item cost", money(t.itemCost)],
          ["Profit", money(t.profit)],
        ].map(([k, v]) => (
          <div key={k} className="bg-white border border-brand-ink/15 rounded-lg p-3">
            <p className="text-xs uppercase tracking-wider text-brand-ink/50">{k}</p>
            <p className="text-xl font-semibold mt-1">{v}</p>
          </div>
        ))}
      </div>
      {t.incomplete > 0 && (
        <p className="text-sm text-amber-800 mb-6">
          {t.incomplete} of {t.orders} sales are missing postage or an item cost, so profit is overstated by those
          amounts.
        </p>
      )}

      {r.byVenue.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs mb-6">
          {r.byVenue.map((v) => (
            <span key={v.venue} className="px-2 py-1 rounded bg-brand-ink/5">
              {VENUE[v.venue] ?? v.venue}: {v.orders} · {money(v.revenue)} · profit {money(v.profit)}
            </span>
          ))}
        </div>
      )}

      {!r.orders.length ? (
        <p className="text-brand-ink/60 text-sm">No sales in {label} yet. The books start on the to-ship queue&apos;s start date.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-brand-ink/60 border-b">
                <th className="py-2">Sold</th>
                <th className="py-2">Venue</th>
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Revenue</th>
                <th className="py-2 text-right">Fees</th>
                <th className="py-2 text-right">Postage</th>
                <th className="py-2 text-right">Item cost</th>
                <th className="py-2 text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {r.orders.map((o) => (
                <tr key={o.id} className="border-b align-top">
                  <td className="py-2 whitespace-nowrap">
                    {o.soldAt
                      ? new Date(/Z|[+-]\d\d:?\d\d$/.test(o.soldAt) ? o.soldAt : `${o.soldAt}Z`).toLocaleDateString("en-US", {
                          timeZone: "America/Chicago",
                          month: "short",
                          day: "numeric",
                        })
                      : ""}
                  </td>
                  <td className="py-2 whitespace-nowrap">{VENUE[o.venue] ?? o.venue}</td>
                  <td className="py-2 pr-4">
                    {o.lines.map((l, i) => (
                      <div key={i}>
                        {l.qty > 1 && <b>{l.qty}× </b>}
                        {l.title}
                        {l.cost == null && <span className="ml-2 text-xs text-amber-700">no cost</span>}
                      </div>
                    ))}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">{money(o.revenue)}</td>
                  <td className="py-2 text-right whitespace-nowrap" title={o.feesEstimated ? "estimated" : "from eBay"}>
                    {money(o.fees)}
                    {o.feesEstimated && <span className="text-brand-ink/40"> est</span>}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {o.shippingCostEntered == null && o.shippingCost === 0 ? (
                      <span className="text-brand-ink/50" title="buyer pays the label">$0.00</span>
                    ) : (
                      <PostageInput orderId={o.id} value={o.shippingCostEntered} />
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">{money(o.itemCost)}</td>
                  <td className={`py-2 text-right whitespace-nowrap font-semibold ${o.incomplete ? "text-amber-800" : ""}`}>
                    {money(o.profit)}
                    {o.incomplete && "*"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-brand-ink/50 mt-2">* missing postage or an item cost</p>
        </div>
      )}
    </section>
  );
}
