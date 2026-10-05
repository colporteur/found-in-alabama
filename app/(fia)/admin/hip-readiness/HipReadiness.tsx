"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { STATUS_LABELS, readinessCsv, type ReadinessReport, type ReadinessStatus } from "@/lib/hip/readiness";

const PAGE_SIZE = 50;
const badgeColors: Record<ReadinessStatus, string> = {
  listed: "bg-blue-50 text-blue-800", ready: "bg-green-50 text-green-800", unchecked: "bg-slate-100 text-slate-700",
  needs_category: "bg-amber-50 text-amber-900", needs_data: "bg-orange-50 text-orange-900", needs_review: "bg-rose-50 text-rose-900", excluded: "bg-stone-100 text-stone-600",
};

function saveDownload(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HipReadiness() {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<ReadinessStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  async function refresh(compare = false) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/hip-readiness${compare ? "?compare=1" : ""}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load the report.");
      setReport(body);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the report.");
    } finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (report?.rows ?? []).filter((r) => (status === "all" || r.status === status) && (!needle || [r.title, r.itemId, r.sku, r.siteCategory, ...r.storeCategories].join(" ").toLowerCase().includes(needle)));
  }, [report, query, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const zeroQuantityOnHip = report?.hipUnmatched.filter((l) => l.inventoryStatus === "zero_quantity").length ?? 0;

  return <section className="container-content py-10">
    <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">The Ephemeral State · Sales channels</p>
    <h1 className="font-marker text-3xl md:text-4xl mb-3">HipPostcard readiness</h1>
    <p className="text-brand-ink/70 max-w-3xl mb-5">Review the inventory selected for your website, see what fits Hip, and compare it with your existing Hip listings. This preview only reads inventory.</p>
    <div className="flex flex-wrap gap-3 mb-6 items-center">
      <button disabled={busy} onClick={() => void refresh(false)} className="border border-brand-ink/20 bg-white rounded px-4 py-2 text-sm disabled:opacity-50">Refresh inventory</button>
      <button disabled={busy || !report?.connectionConfigured} onClick={() => void refresh(true)} className="bg-brand-ink text-white rounded px-4 py-2 text-sm disabled:opacity-40">{busy ? "Reading inventory…" : "Compare with Hip"}</button>
      <Link href="/admin/ebay/categories" className="text-sm underline underline-offset-4">Manage website selection</Link>
      <Link href="/admin/tes-orders" className="text-sm underline underline-offset-4">Orders & delists</Link>
    </div>
    <div role="status" aria-live="polite">{busy && <p className="mb-4 text-sm">Reading listings. A Hip comparison may take up to a minute.</p>}</div>
    {error && <p role="alert" className="mb-5 bg-red-50 border border-red-200 text-red-800 rounded p-4">{error}{report ? " The previous report is still shown below." : ""}</p>}
    {report && <>
      <div className={`rounded-lg border p-4 mb-6 ${report.snapshot.state === "complete" ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
        <p className="font-semibold text-sm">{report.snapshot.state === "complete" ? "Hip comparison complete" : report.snapshot.state === "not_connected" ? "Hip connection needed" : "Hip coverage not yet confirmed"}</p>
        <p className="text-sm mt-1">{report.snapshot.message}</p>
        {report.snapshot.checkedAt && <p className="text-xs mt-2">Read {report.snapshot.listingCount.toLocaleString()} Hip listings across {report.snapshot.pages} pages · {new Date(report.snapshot.checkedAt).toLocaleString()}</p>}
      </div>
      {zeroQuantityOnHip > 0 && <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-6 text-sm">
        <p className="font-semibold">Check availability: {zeroQuantityOnHip} active Hip listings have zero quantity in the inventory cache.</p>
        <p className="mt-1">Verify these against current eBay inventory before adding more listings. The cache alone does not confirm a sale.</p>
        <a href="#hip-inventory-review" className="inline-block mt-2 underline">Review the affected listings ↓</a>
      </div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {(["all", ...Object.keys(STATUS_LABELS)] as const).map((key) => <button key={key} aria-pressed={status === key} onClick={() => { setStatus(key as ReadinessStatus | "all"); setPage(1); }} className={`text-left rounded-lg border p-4 ${status === key ? "border-brand-ink bg-brand-yellow/20" : "border-brand-ink/15 bg-white"}`}>
          <span className="block text-xs text-brand-ink/70">{key === "all" ? "Selected website inventory" : STATUS_LABELS[key as ReadinessStatus]}</span>
          <span className="block text-2xl font-semibold mt-1">{report.snapshot.state !== "complete" && (key === "ready" || (key === "listed" && !report.counts.listed)) ? "—" : (key === "all" ? report.rows.length : report.counts[key as ReadinessStatus]).toLocaleString()}</span>
        </button>)}
      </div>
      <p className="text-sm text-brand-ink/65 mb-5">Each item is grouped by its next review step; its details may list additional issues. Category suggestions cover postcards and selected paper categories. Pilot candidates still need current availability, price, and shipping checks. Prices below are inventory prices before website discounts. A dash means Hip coverage is not yet known.</p>
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <label className="flex-1 min-w-48 text-sm">Search inventory
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Title, item number, bin, or category" className="block border border-brand-ink/20 rounded px-3 py-2 bg-white w-full mt-1" />
        </label>
        <button disabled={busy} onClick={() => saveDownload(readinessCsv(filtered), "hip-readiness.csv", "text/csv;charset=utf-8")} className="border border-brand-ink/20 bg-white rounded px-4 py-2 text-sm disabled:opacity-50">Export filtered rows</button>
        <button disabled={busy} onClick={() => saveDownload(JSON.stringify(report, null, 2), "hip-readiness-report.json", "application/json")} className="border border-brand-ink/20 bg-white rounded px-4 py-2 text-sm disabled:opacity-50">Save full report</button>
      </div>
      <p className="text-xs text-brand-ink/60 mb-3">{filtered.length.toLocaleString()} matching items · Report generated {new Date(report.generatedAt).toLocaleString()}</p>
      <div className="space-y-3">
        {!shown.length && <p className="bg-white border rounded-lg p-8 text-center text-brand-ink/60">No items match this view.</p>}
        {shown.map((row) => <article key={row.itemId} className="bg-white rounded-lg border border-brand-ink/15 p-4 flex flex-col sm:flex-row gap-4">
          <div className="w-24 h-24 shrink-0 bg-stone-50 rounded flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {row.image ? <img src={row.image} alt="" loading="lazy" className="max-w-full max-h-full object-contain" /> : <span className="text-xs text-stone-400">No image</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
              <h2 className="font-semibold text-sm max-w-2xl"><a href={`https://www.ebay.com/itm/${row.itemId}`} target="_blank" rel="noreferrer" className="hover:underline">{row.title || "Untitled item"} ↗</a></h2>
              <span className={`text-xs rounded px-2 py-1 ${badgeColors[row.status]}`}>{STATUS_LABELS[row.status]}</span>
            </div>
            <p className="text-xs text-brand-ink/60 mb-2">{row.price ? `$${row.price}` : "No price"} · Qty {row.quantity} · {row.imageCount} photos · Bin {row.sku || "—"} · eBay {row.itemId}</p>
            <p className="text-xs mb-2"><span className="font-semibold">Suggested Hip category:</span> {row.category?.name ?? "Needs a decision"}</p>
            <ul className="text-xs text-brand-ink/70 list-disc pl-4 space-y-1">{row.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            {(row.hipIds.length > 0 || row.possibleHipIds.length > 0) && <p className="text-xs mt-2">{row.hipIds.length > 0 && `Linked Hip listing(s): ${row.hipIds.join(", ")}. `}{row.possibleHipIds.length > 0 && `Possible title match(es): ${row.possibleHipIds.join(", ")}.`}</p>}
            <details className="text-xs mt-3 text-brand-ink/65"><summary className="cursor-pointer">Inventory details</summary>
              <p className="mt-2">eBay category: {row.siteCategory || "Unknown"}</p>
              <p>Store categories: {row.storeCategories.join(" · ") || "Unknown"}</p>
              <p>Last inventory refresh: {row.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString() : "Unknown"}</p>
              <p className="mt-2">{row.descriptionPreview || "No description cached."}</p>
            </details>
          </div>
        </article>)}
      </div>
      <div className="flex items-center justify-between gap-3 my-6 text-sm">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="border rounded px-4 py-2 bg-white disabled:opacity-40">Previous</button>
        <span>Page {page} of {pageCount}</span>
        <button disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} className="border rounded px-4 py-2 bg-white disabled:opacity-40">Next</button>
      </div>
      {report.snapshot.checkedAt && <details id="hip-inventory-review" open={zeroQuantityOnHip > 0} className="border rounded-lg bg-white p-4 mb-5">
        <summary className="font-semibold text-sm cursor-pointer">Hip listings without an exact link to this selection ({report.hipUnmatched.length.toLocaleString()})</summary>
        <p className="text-sm mt-3 mb-3">These may belong outside the website selection or need identity matching. They are not automatically considered duplicates or removal candidates.</p>
        {report.hipUnmatched.slice(0, 100).map((l) => <div key={l.id} className="text-xs py-3 border-t border-brand-ink/10">
          <p className="font-semibold">{l.url ? <a href={l.url} target="_blank" rel="noreferrer" className="underline">{l.name} ↗</a> : l.name}</p>
          <p className="mt-1">Hip {l.id} · {l.externalId ? <a href={`https://www.ebay.com/itm/${l.externalId}`} target="_blank" rel="noreferrer" className="underline">eBay {l.externalId} ↗</a> : "No eBay item link"}</p>
          <p className={`mt-1 ${l.inventoryStatus === "zero_quantity" ? "text-red-800 font-semibold" : "text-brand-ink/65"}`}>
            {l.inventoryStatus === "zero_quantity" ? "Zero quantity in the cache — verify current availability." : l.inventoryStatus === "outside_selection" ? "In stock in the cache, outside the website selection." : l.inventoryStatus === "not_in_mirror" ? "Not yet in the inventory cache; may be a recent listing." : l.inventoryStatus === "unknown_quantity" ? "Cached quantity is unknown." : "Needs an exact inventory link."}
          </p>
          {l.inventoryLastSyncedAt && <p className="text-brand-ink/60 mt-1">Last inventory refresh: {new Date(l.inventoryLastSyncedAt).toLocaleString()}</p>}
        </div>)}
        {report.hipUnmatched.length > 100 && <p className="text-xs mt-2">Showing the first 100. Save the full report for the complete list.</p>}
      </details>}
    </>}
    <aside className="border-t border-brand-ink/15 pt-5 text-sm text-brand-ink/70 max-w-3xl">
      <h2 className="font-semibold text-brand-ink mb-2">Considering a fresh start?</h2>
      <p>Hip supports closing listings and permanent deletion. A reset should follow a full inventory export and a review of open orders, with native eBay imports disabled before the change. The report above is a comparison record, not a restorable listing backup.</p>
      <p className="mt-2"><a href="https://hip-ecommerce.readme.io/reference/deletelisting" target="_blank" rel="noreferrer" className="underline">Hip’s close and delete documentation ↗</a></p>
    </aside>
  </section>;
}
