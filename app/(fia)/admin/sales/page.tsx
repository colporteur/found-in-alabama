// /admin/sales — sale detection, shadow mode (Phase SALES-1). Every sale on
// every venue, the item it was matched to, which other listings should have
// come down, and whether they did (Nifty is still the one delisting).
// The scoreboard is the Phase 7 readiness test.

import Link from "next/link";
import { loadSalesReport, type FeedRow } from "@/lib/sales/report";
import { RunSalesSyncButton, MatchControls } from "./SalesButtons";

export const dynamic = "force-dynamic";

const VENUE: Record<string, string> = {
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

const SOURCE: Record<string, string> = {
  ebay_events: "eBay events",
  hip: "Hip poller",
  stripe: "Stripe checkout",
  email: "Sale email",
  manual: "Manual",
};

const METHOD: Record<string, string> = {
  exact_id: "listing id",
  ebay_id: "eBay id",
  title_exact: "title",
  title_prefix: "title start",
  manual: "by hand",
};

const OUTCOME_STYLE: Record<string, string> = {
  done: "bg-green-100 text-green-800",
  pending: "bg-gray-100 text-gray-700",
  unverified: "bg-gray-100 text-gray-700",
  still_live: "bg-amber-100 text-amber-800",
  failed_nifty: "bg-red-100 text-red-800",
};

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const money = (n: number | null) => (n == null ? "" : `$${n.toFixed(2)}`);
const when = (s: string | null) =>
  s ? new Date(s.endsWith("Z") || s.includes("+") ? s : `${s}Z`).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : "";
const mins = (m: number | null) =>
  m == null ? "—" : m < 90 ? `${m} min` : m < 48 * 60 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`;

export default async function SalesPage() {
  const r = await loadSalesReport();

  if (!r.ready) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">Sale detection</h1>
        <p className="text-brand-ink/80">
          The sale tables don&apos;t exist yet. Run the migration (<code>npm run db:migrate</code>), then
          come back and click “Run now”.
        </p>
      </section>
    );
  }

  const totalSales = r.venues.reduce((a, v) => a + v.sales, 0);
  const totalAuto = r.venues.reduce((a, v) => a + v.autoMatched, 0);
  const totalLegs = r.legs.reduce((a, l) => a + l.planned, 0);
  const totalDone = r.legs.reduce((a, l) => a + l.done, 0);

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Inventory · shadow mode</p>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h1 className="font-marker text-4xl md:text-5xl">Sale detection</h1>
          <p className="text-sm text-brand-ink/60 mt-2">
            Watching every venue and scoring Nifty&apos;s delisting. Nothing here delists anything.
            {r.lastRunAt && <> Last change {when(r.lastRunAt)}.</>}
          </p>
        </div>
        <RunSalesSyncButton />
      </div>

      <div className="grid gap-4 sm:grid-cols-4 my-8">
        <Stat label={`Sales, last ${r.days} days`} value={fmt(totalSales)} />
        <Stat label="Matched automatically" value={pct(totalAuto, totalSales)} />
        <Stat label="Delists confirmed" value={`${fmt(totalDone)} / ${fmt(totalLegs)}`} />
        <Stat label="To review" value={fmt(r.review.length)} />
      </div>

      {r.doubleSales > 0 && (
        <p className="mb-8 px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-900">
          {fmt(r.doubleSales)} sale{r.doubleSales === 1 ? "" : "s"} flagged as a possible double sale (the same
          item sold on two venues within a week). See the feed below.
        </p>
      )}

      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">Sales by venue</h2>
      <Table
        head={["Venue", "Sales", "Auto-matched", "By hand", "To review", "Duplicates"]}
        rows={r.venues.map((v) => [
          VENUE[v.venue] ?? v.venue,
          fmt(v.sales),
          `${fmt(v.autoMatched)} (${pct(v.autoMatched, v.sales)})`,
          fmt(v.manual),
          fmt(v.review),
          fmt(v.duplicates),
        ])}
        empty="No sales seen yet."
      />

      <div className="grid gap-8 lg:grid-cols-2 mb-12">
        <div>
          <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">Nifty&apos;s delisting (the score)</h2>
          <Table
            head={["Listing on", "Should come down", "Done", "Median time", "Still up", "Nifty failed", "Unverified"]}
            rows={r.legs.map((l) => [
              VENUE[l.venue] ?? l.venue,
              fmt(l.planned),
              `${fmt(l.done)} (${pct(l.done, l.planned)})`,
              mins(l.medianMinutesToDone),
              fmt(l.stillLive),
              fmt(l.failedNifty),
              fmt(l.unverified + l.pending),
            ])}
            empty="No delists planned yet."
            note={`Still up after 1 h: ${fmt(r.stillLiveAges.over1h)} · 6 h: ${fmt(r.stillLiveAges.over6h)} · 24 h: ${fmt(
              r.stillLiveAges.over24h
            )}. Mercari, Poshmark, Depop and Whatnot are confirmed by the next Nifty Sync capture; until then they show as unverified.`}
          />
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">How fast sales are seen</h2>
          <Table
            head={["Signal", "Sales", "Median delay"]}
            rows={r.delay.map((d) => [SOURCE[d.source] ?? d.source, fmt(d.sales), mins(d.medianMinutes)])}
            empty="No timed sales yet."
            note="eBay sales are timed by the 15-minute events sync and aren't listed here."
          />
          {r.missed.length > 0 && (
            <>
              <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">
                Sold per Nifty, never seen here
              </h2>
              <Table
                head={["Venue", "Items"]}
                rows={r.missed.map((m) => [VENUE[m.venue] ?? m.venue, fmt(m.count)])}
                empty=""
                note="From Nifty Sync captures since detection started. Check that venue's sale emails are being forwarded."
              />
            </>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2 mb-12">
        <div>
          <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">Venue health (Nifty notices, 7 days)</h2>
          <Table
            head={["Venue", "Notice", "Count", "Latest"]}
            rows={r.niftyRecent.map((a) => [
              VENUE[a.venue] ?? a.venue,
              a.kind === "nifty_reconnect" ? "Reconnect requested" : a.kind === "nifty_failed_adjust" ? "Failed auto-adjust" : "Failed auto-delist",
              fmt(a.count),
              when(a.last),
            ])}
            empty="No Nifty notices in the last week."
            note="Etsy notices are expected: the Etsy account is suspended."
          />
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">Nifty failures by reason ({r.days} days)</h2>
          <Table
            head={["Venue", "Reason", "Count"]}
            rows={r.niftyFailures.map((f) => [VENUE[f.venue] ?? f.venue, f.reason, fmt(f.count)])}
            empty="None."
          />
        </div>
      </div>

      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">Review queue</h2>
      {r.review.length === 0 ? (
        <p className="text-sm text-brand-ink/60 mb-12">Nothing to review.</p>
      ) : (
        <div className="space-y-3 mb-12">
          {r.review.map((q) => (
            <div key={q.id} className="bg-white border border-brand-ink/15 rounded-lg p-4 grid gap-3 md:grid-cols-2">
              <div className="text-sm">
                <p className="font-medium">
                  {q.title ?? "(no title)"}
                  {q.titleTruncated && <span className="text-brand-ink/50"> …</span>}
                </p>
                <p className="text-brand-ink/60 text-xs mt-1">
                  {VENUE[q.venue] ?? q.venue} · {money(q.price)} · {when(q.soldAt)} ·{" "}
                  {q.status === "ambiguous" ? `${q.candidates.length} items share this title` : q.note ?? "no match"}
                  {q.venueListingId && <> · listing {q.venueListingId}</>}
                </p>
              </div>
              <MatchControls
                id={q.id}
                candidates={q.candidates.map((c) => ({
                  id: c.id,
                  label: `${c.title.slice(0, 60)}${c.bin ? ` · bin ${c.bin}` : ""}${c.ebayItemId ? ` · eBay ${c.ebayItemId}` : ""} (${c.status})`,
                }))}
              />
            </div>
          ))}
        </div>
      )}

      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">Latest sales</h2>
      <div className="bg-white border border-brand-ink/15 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-ink/5 text-left">
            <tr>
              <th className="px-3 py-2">Sold</th>
              <th className="px-3 py-2">Venue</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2">Matched by</th>
              <th className="px-3 py-2">Other listings</th>
            </tr>
          </thead>
          <tbody>
            {r.feed.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-brand-ink/50">
                  No sales yet.
                </td>
              </tr>
            )}
            {r.feed.map((f) => (
              <FeedLine key={f.id} f={f} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FeedLine({ f }: { f: FeedRow }) {
  return (
    <tr className="border-t border-brand-ink/10 align-top">
      <td className="px-3 py-2 whitespace-nowrap">{when(f.soldAt ?? f.detectedAt)}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        {VENUE[f.venue] ?? f.venue}
        <span className="block text-xs text-brand-ink/50">{SOURCE[f.source] ?? f.source}</span>
      </td>
      <td className="px-3 py-2">
        {f.itemTitle ?? f.title}
        {f.ebayItemId && (
          <Link href={`https://www.ebay.com/itm/${f.ebayItemId}`} target="_blank" className="ml-2 text-xs underline">
            eBay
          </Link>
        )}
        {f.flag === "double_sale" && (
          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-800">double sale?</span>
        )}
        {f.note && <span className="block text-xs text-brand-ink/50">{f.note}</span>}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">{money(f.price)}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        {f.status === "matched" ? METHOD[f.matchMethod ?? ""] ?? f.matchMethod : f.status}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {f.legs.length === 0 && <span className="text-xs text-brand-ink/40">—</span>}
          {f.legs.map((l, i) => (
            <span
              key={i}
              title={l.outcomeAt ? `${l.action} · ${when(l.outcomeAt)}` : l.action}
              className={`text-xs px-1.5 py-0.5 rounded ${OUTCOME_STYLE[l.outcome] ?? "bg-gray-100"}`}
            >
              {VENUE[l.venue] ?? l.venue}: {l.outcome.replace("_", " ")}
            </span>
          ))}
        </div>
      </td>
    </tr>
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

function Table({ head, rows, empty, note }: { head: string[]; rows: string[][]; empty: string; note?: string }) {
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg overflow-x-auto mb-8">
      <table className="w-full text-sm">
        <thead className="bg-brand-ink/5 text-left">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty && (
            <tr>
              <td colSpan={head.length} className="px-3 py-3 text-brand-ink/50">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-brand-ink/10">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-2 ${j > 0 ? "text-right" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="text-xs text-brand-ink/50 px-3 py-2 border-t border-brand-ink/10">{note}</p>}
    </div>
  );
}
