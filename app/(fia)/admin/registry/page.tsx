// /admin/registry — the item registry (Phase REG-1): one record per physical
// item with every venue listing for it. Shows coverage across venues, venue
// connection status, and the review queue the sync couldn't settle.

import Link from "next/link";
import { loadRegistryReport } from "@/lib/registry/report";
import { RunSyncButton, ReviewToggle } from "./RegistryButtons";

export const dynamic = "force-dynamic";

const VENUE_LABEL: Record<string, string> = {
  ebay: "eBay",
  mercari: "Mercari",
  poshmark: "Poshmark",
  depop: "Depop",
  whatnot: "Whatnot",
  hip: "HipPostcard",
  etsy: "Etsy",
  tes: "The Ephemeral State",
  fia: "Found in Alabama",
};

const STATE_STYLE: Record<string, string> = {
  connected: "bg-green-100 text-green-800",
  via_nifty: "bg-blue-100 text-blue-800",
  expired: "bg-amber-100 text-amber-800",
  suspended: "bg-red-100 text-red-800",
  disconnected: "bg-gray-100 text-gray-700",
};

const REVIEW_INFO: Record<string, { title: string; help: string }> = {
  ebay_not_in_nifty: {
    title: "For sale on eBay, no Nifty record",
    help: "Other venue links are unknown. A fresh Nifty Sync capture (Listed view, every page) usually clears these.",
  },
  nifty_active_ebay_missing: {
    title: "Nifty says listed, eBay listing not in the mirror",
    help: "Usually listed in the last day (the eBay mirror adds new listings at the daily sweep) or the eBay listing ended while the item stays listed elsewhere.",
  },
  nifty_active_no_ebay: {
    title: "Nifty item with no eBay link",
    help: "Listed only on other venues, or the eBay link wasn't captured.",
  },
};

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

export default async function RegistryPage() {
  const r = await loadRegistryReport();

  if (!r.ready) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">Item registry</h1>
        <p className="text-brand-ink/80">
          The registry tables don&apos;t exist yet. Run the migration (
          <code>npm run db:migrate</code>), then come back and click “Run sync now”.
        </p>
      </section>
    );
  }

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Inventory</p>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-marker text-4xl md:text-5xl">Item registry</h1>
          <p className="text-sm text-brand-ink/60 mt-2">
            One record per physical item, with every venue listing for it.
            {r.lastUpdated && <> Last change {new Date(r.lastUpdated).toLocaleString("en-US")}.</>}
          </p>
        </div>
        <RunSyncButton />
      </div>

      <div className="grid gap-4 sm:grid-cols-4 mb-12">
        <Stat label="Items" value={fmt(r.totals.total)} />
        <Stat label="Live" value={fmt(r.totals.live)} />
        <Stat label="Sold (history kept)" value={fmt(r.totals.sold)} />
        <Stat label="For sale on eBay" value={fmt(r.forSaleOnEbay)} />
      </div>

      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        Cross-venue coverage of items for sale on eBay
      </h2>
      <div className="bg-white border border-brand-ink/15 rounded-lg overflow-hidden mb-12">
        <table className="w-full text-sm">
          <thead className="bg-brand-ink/5 text-left">
            <tr>
              <th className="px-4 py-2">Venue</th>
              <th className="px-4 py-2 text-right">Items linked</th>
              <th className="px-4 py-2 text-right">Share</th>
              <th className="px-4 py-2 text-right">Known live</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-brand-ink/10">
              <td className="px-4 py-2">Nifty record (any)</td>
              <td className="px-4 py-2 text-right">{fmt(r.withNifty)}</td>
              <td className="px-4 py-2 text-right">{pct(r.withNifty, r.forSaleOnEbay)}</td>
              <td className="px-4 py-2 text-right text-brand-ink/40">—</td>
            </tr>
            {r.coverage.map((c) => (
              <tr key={c.venue} className="border-t border-brand-ink/10">
                <td className="px-4 py-2">{VENUE_LABEL[c.venue] ?? c.venue}</td>
                <td className="px-4 py-2 text-right">{fmt(c.linked)}</td>
                <td className="px-4 py-2 text-right">{pct(c.linked, r.forSaleOnEbay)}</td>
                <td className="px-4 py-2 text-right">{fmt(c.live)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-brand-ink/50 px-4 py-2 border-t border-brand-ink/10">
          “Known live” fills in as Nifty Sync captures report each venue&apos;s status
          (older links start as “unknown”).
        </p>
      </div>

      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">Venue status</h2>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-12">
        {r.venueStatus.map((v) => (
          <div key={v.venue} className="bg-white border border-brand-ink/15 rounded-lg p-3">
            <p className="font-medium text-sm mb-1">{VENUE_LABEL[v.venue] ?? v.venue}</p>
            <span
              className={`inline-block text-xs px-2 py-0.5 rounded ${STATE_STYLE[v.state] ?? "bg-gray-100"}`}
            >
              {v.state.replace("_", " ")}
            </span>
            {v.note && <p className="text-xs text-brand-ink/60 mt-2">{v.note}</p>}
          </div>
        ))}
      </div>

      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">Review queue</h2>
      {r.review.length === 0 && <p className="text-sm text-brand-ink/60 mb-8">Nothing to review.</p>}
      {r.review.map((q) => {
        const info = REVIEW_INFO[q.kind] ?? { title: q.kind, help: "" };
        const sample = r.reviewSamples[q.kind] ?? [];
        return (
          <details key={q.kind} className="bg-white border border-brand-ink/15 rounded-lg mb-4">
            <summary className="cursor-pointer px-4 py-3 flex flex-wrap items-baseline gap-3">
              <span className="font-medium">{info.title}</span>
              <span className="font-marker text-xl">{fmt(q.open)}</span>
              {q.dismissed > 0 && (
                <span className="text-xs text-brand-ink/50">{fmt(q.dismissed)} dismissed</span>
              )}
            </summary>
            <div className="px-4 pb-4">
              {info.help && <p className="text-sm text-brand-ink/70 mb-3">{info.help}</p>}
              {sample.length === 0 ? (
                <p className="text-sm text-brand-ink/50">No open rows.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-brand-ink/50">
                    <tr>
                      <th className="py-1 pr-3">Title</th>
                      <th className="py-1 pr-3">Bin</th>
                      <th className="py-1 pr-3">eBay</th>
                      <th className="py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {sample.map((s) => {
                      const ebayId = s.detail.ebay_item_id ? String(s.detail.ebay_item_id) : null;
                      return (
                        <tr key={s.id} className="border-t border-brand-ink/10">
                          <td className="py-1 pr-3">{String(s.detail.title ?? "")}</td>
                          <td className="py-1 pr-3 whitespace-nowrap">{String(s.detail.bin ?? "")}</td>
                          <td className="py-1 pr-3">
                            {ebayId ? (
                              <Link
                                href={`https://www.ebay.com/itm/${ebayId}`}
                                target="_blank"
                                className="underline"
                              >
                                {ebayId}
                              </Link>
                            ) : (
                              <span className="text-brand-ink/40">—</span>
                            )}
                          </td>
                          <td className="py-1 text-right">
                            <ReviewToggle id={s.id} dismissed={false} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {q.open > sample.length && (
                <p className="text-xs text-brand-ink/50 mt-2">
                  Showing the first {sample.length} of {fmt(q.open)}.
                </p>
              )}
            </div>
          </details>
        );
      })}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">{label}</p>
      <p className="font-marker text-3xl">{value}</p>
    </div>
  );
}
