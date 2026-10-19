// /admin/ship/coupons — invoice coupon codes (COUPON-1). Every invoice gets
// its own one-use code for a next order on foundinalabama.com or
// theephemeralstate.com; nothing to start or end. Here: the percent, how
// long codes last, which venues' invoices get one, and how they're used.

import Link from "next/link";
import { couponSettings, couponsReady, recentCodes } from "@/lib/shop/coupons";
import { CouponSettingsForm } from "./CouponSettingsForm";

export const dynamic = "force-dynamic";

const fmt = (v: string | null) =>
  v ? new Date(v.endsWith("Z") || v.includes("+") ? v : `${v}Z`).toLocaleDateString("en-US", { timeZone: "America/Chicago", dateStyle: "medium" }) : "";

export default async function CouponsPage() {
  const ready = await couponsReady().catch(() => false);
  if (!ready) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">Invoice coupons</h1>
        <p className="text-brand-ink/80">
          Not ready yet: run the migration (<code>npm run db:migrate</code>). Stripe must be set up too (it is, if
          the shops take payments).
        </p>
      </section>
    );
  }
  const [settings, { stats, codes }] = await Promise.all([couponSettings(), recentCodes(150)]);
  const now = Date.now();
  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/ship" className="hover:underline">Fulfillment</Link>
      </p>
      <h1 className="font-marker text-4xl md:text-5xl mb-2">Invoice coupons</h1>
      <p className="text-sm text-brand-ink/60 mb-6 max-w-3xl">
        Each package&apos;s invoice prints its own code, good for one order on either website. The code is made the
        first time the invoice opens (a reprint shows the same one), expires on its own, and stops working once
        used. Stripe checks it at checkout; it takes the percent off the items, not shipping. A change here applies
        to codes made from now on.
      </p>

      <CouponSettingsForm initial={settings} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-8 max-w-3xl text-sm">
        <Stat label="Codes printed" value={String(stats.issued)} />
        <Stat label="Used" value={`${stats.used}${stats.issued ? ` (${Math.round((100 * stats.used) / stats.issued)}%)` : ""}`} />
        <Stat label="Orders with a code" value={`$${stats.sales.toFixed(2)}`} />
        <Stat label="Given in discounts" value={`$${stats.discounts.toFixed(2)}`} />
      </div>

      <h2 className="font-semibold mb-2">Recent codes</h2>
      {codes.length === 0 ? (
        <p className="text-sm text-brand-ink/60">None yet — they appear when invoices are opened.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm min-w-full">
            <thead className="text-left text-xs uppercase tracking-wider text-brand-ink/50">
              <tr>
                <th className="py-1 pr-4">Code</th>
                <th className="py-1 pr-4">Off</th>
                <th className="py-1 pr-4">Pitched</th>
                <th className="py-1 pr-4">Invoice</th>
                <th className="py-1 pr-4">Issued</th>
                <th className="py-1 pr-4">Expires</th>
                <th className="py-1 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const expired = new Date(c.expiresAt.endsWith("Z") || c.expiresAt.includes("+") ? c.expiresAt : `${c.expiresAt}Z`).getTime() < now;
                return (
                  <tr key={c.code} className="border-t border-brand-ink/10">
                    <td className="py-1 pr-4 font-mono font-semibold">{c.code}</td>
                    <td className="py-1 pr-4">{c.percent}%</td>
                    <td className="py-1 pr-4">{c.code.startsWith("TES") ? "TES" : "FIA"}</td>
                    <td className="py-1 pr-4">{[c.venue, c.buyer].filter(Boolean).join(" · ")}</td>
                    <td className="py-1 pr-4">{fmt(c.issuedAt)}</td>
                    <td className="py-1 pr-4">{fmt(c.expiresAt)}</td>
                    <td className="py-1 pr-4">
                      {c.redeemedAt ? (
                        <span className="text-green-700 font-semibold">
                          Used {fmt(c.redeemedAt)}
                          {c.redeemedTotal != null && ` · $${c.redeemedTotal.toFixed(2)} order`}
                        </span>
                      ) : expired ? (
                        <span className="text-brand-ink/40">Expired</span>
                      ) : (
                        "Open"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-brand-ink/15 p-3">
      <p className="text-xs uppercase tracking-wider text-brand-ink/50">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
