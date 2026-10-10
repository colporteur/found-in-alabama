// /admin/sales/readiness — the Phase 7 test per venue: 30 clean days in a
// row of FIA seeing every sale and planning every delist right (Nifty still
// does the delisting). One square per day since the clock started.

import Link from "next/link";
import { readinessReport, type VenueReadiness } from "@/lib/sales/readiness";
import { READY_DAYS, type ScoredDay } from "@/lib/sales/readiness-core";

export const dynamic = "force-dynamic";

const NAME: Record<string, string> = {
  ebay: "eBay",
  mercari: "Mercari",
  poshmark: "Poshmark",
  depop: "Depop",
  whatnot: "Whatnot",
  hip: "HipPostcard",
};

const SQUARE: Record<string, string> = {
  clean: "bg-green-500",
  problem: "bg-red-500",
  unchecked: "bg-gray-300",
  today: "bg-white border border-brand-ink/30",
};

const when = (s: string | null) =>
  s ? new Date(s.endsWith("Z") || s.includes("+") ? s : `${s}Z`).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) : "never";

function dayTitle(d: ScoredDay) {
  const facts = [`${d.sales} sale${d.sales === 1 ? "" : "s"}`, `${d.legs} delist${d.legs === 1 ? "" : "s"} planned`];
  return `${d.day}: ${d.state}${d.why.length ? " — " + d.why.join("; ") : ""} (${facts.join(", ")})`;
}

function Venue({ v }: { v: VenueReadiness }) {
  const status = v.ready
    ? { text: "Ready", cls: "bg-green-100 text-green-900" }
    : v.problems > 0 && v.streak === 0
      ? { text: "Problem to fix", cls: "bg-red-100 text-red-900" }
      : { text: `${v.streak} of ${READY_DAYS} clean days`, cls: "bg-amber-50 text-amber-900" };
  const nonApi = !["ebay", "hip"].includes(v.venue);
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5 mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-xl font-semibold">{NAME[v.venue]}</h2>
        <span className={`text-sm px-2 py-0.5 rounded ${status.cls}`}>{status.text}</span>
      </div>
      <div className="flex flex-wrap gap-1 mb-2" aria-label="Days since the clock started">
        {v.days.map((d) => (
          <span key={d.day} title={dayTitle(d)} className={`inline-block w-4 h-4 rounded-sm ${SQUARE[d.state]}`} />
        ))}
      </div>
      <p className="text-xs text-brand-ink/60 mb-4">
        Since {v.start}: {v.clean} clean, {v.problems} with a problem, {v.unchecked} not checked yet. Hover a day for details.
      </p>

      <div className="grid sm:grid-cols-3 gap-4 text-sm mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-1">1 · Sales seen</p>
          <p>{v.totals.sales} sales detected; {v.issues.filter((i) => i.kind === "missed sale").length} missed, {v.issues.filter((i) => i.kind === "unmatched sale").length} unmatched.</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-1">2 · Delists right</p>
          <p>
            {v.totals.legsDone} of {v.totals.legs} confirmed
            {v.totals.legsNiftyFailed > 0 && <>, {v.totals.legsNiftyFailed} Nifty failed (FIA was right)</>}
            {v.totals.legsOpen > 0 && <>, {v.totals.legsOpen} waiting</>}. Checked by: {v.verifiedBy}.
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-1">3 · Listings known</p>
          <p>
            {v.listings.live.toLocaleString()} confirmed live
            {v.listings.unknown > 0 && <>, {v.listings.unknown.toLocaleString()} status unknown</>}. Last seen {when(v.listings.lastSeen)}.
          </p>
        </div>
      </div>
      {nonApi && (
        <p className="text-xs text-brand-ink/60 mb-3">
          Still to do before leaving Nifty here: FIA&apos;s own listing/delisting worker for {NAME[v.venue]} (not built yet), tested on a few items.
        </p>
      )}

      {v.issues.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">{v.issues.length} issue{v.issues.length === 1 ? "" : "s"} to look at</summary>
          <ul className="mt-2 text-sm space-y-1">
            {v.issues.slice(0, 50).map((i, k) => (
              <li key={k}>
                <span className="text-xs text-brand-ink/50 mr-2">{i.day}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-800 mr-2">{i.kind}</span>
                {i.title ?? "(no title)"} <span className="text-brand-ink/50">— {i.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default async function ReadinessPage() {
  const r = await readinessReport();
  const stale = !r.lastCheck || Date.now() - Date.parse(r.lastCheck.at) > 36 * 3600_000;
  return (
    <section className="container-content py-12 max-w-4xl">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        <Link href="/admin/sales" className="underline">Sale detection</Link> · Readiness
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">Ready to leave Nifty?</h1>
      <p className="text-brand-ink/70 mb-4 max-w-prose">
        A venue is ready when FIA has gone {READY_DAYS} days in a row seeing every sale there and planning every delist right,
        while Nifty still does the delisting. Green = clean day, red = something FIA got wrong or missed, gray = not checked yet.
      </p>
      <div className={`rounded border p-3 text-sm mb-8 ${stale ? "border-amber-300 bg-amber-50" : "border-brand-ink/15 bg-white"}`}>
        Last Nifty sales check: <strong>{r.lastCheck ? when(r.lastCheck.at) : "never"}</strong>
        {r.lastCheck && <> ({r.lastCheck.items} sales{r.lastCheck.complete ? "" : ", incomplete"})</>}.{" "}
        {stale && (
          <>
            Mercari, Poshmark, Depop and Whatnot days stay gray until it runs: open Nifty, click the{" "}
            <strong>Found in Alabama — Nifty Sync</strong> extension, then <strong>Check sales &amp; delists</strong>. Once a day is plenty.
          </>
        )}
      </div>
      {r.venues.map((v) => (
        <Venue key={v.venue} v={v} />
      ))}
    </section>
  );
}
