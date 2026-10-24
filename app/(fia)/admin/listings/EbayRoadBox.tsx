"use client";

// Listings page: drafts on the straight-to-eBay road (single trading cards by
// default). One button publishes them one at a time: eBay's check first, and
// a draft is listed only if eBay accepts it. Failures stay here with eBay's
// reason; fix the draft (or its card condition on its page) and press again.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Road = { id: string; title: string; price: number; photos: number; cardCondition: string | null; error: string | null };
type Result = { ok: true; itemId: string; warnings: string[] } | { ok: false; error: string };

export function EbayRoadBox({ approved, fromNifty }: { approved: Road[]; fromNifty: Road[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [showNifty, setShowNifty] = useState(false);

  async function run(list: Road[]) {
    for (const d of list) {
      if (results[d.id]?.ok) continue;
      setBusy(d.id);
      let r: Result;
      try {
        const res = await fetch(`/api/admin/listings/${d.id}/ebay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "auto" }),
        });
        const out = await res.json().catch(() => ({}));
        r = out.ok ? { ok: true, itemId: String(out.itemId), warnings: out.warnings ?? [] } : { ok: false, error: out.error ?? `HTTP ${res.status}` };
      } catch (e) {
        r = { ok: false, error: (e as Error).message };
      }
      setResults((prev) => ({ ...prev, [d.id]: r }));
    }
    setBusy(null);
    router.refresh();
  }

  const left = (list: Road[]) => list.filter((d) => !results[d.id]?.ok);
  const row = (d: Road) => {
    const r = results[d.id];
    return (
      <li key={d.id} className="flex flex-wrap gap-x-2 items-baseline">
        <Link href={`/admin/listings/${d.id}`} className="underline">
          {d.title.slice(0, 70)}
        </Link>
        <span className="text-brand-ink/60">
          ${d.price.toFixed(2)}
          {d.cardCondition && ` · ${d.cardCondition}`}
        </span>
        {busy === d.id && <span className="text-blue-800">publishing…</span>}
        {r?.ok && (
          <a className="text-green-800 font-semibold underline" href={`https://www.ebay.com/itm/${r.itemId}`} target="_blank" rel="noreferrer">
            listed {r.itemId}
          </a>
        )}
        {r && !r.ok && <span className="text-red-800">{r.error}</span>}
        {!r && d.error && <span className="text-red-800">last check: {d.error}</span>}
      </li>
    );
  };

  return (
    <div className="mb-6 rounded-lg border-2 border-blue-700 bg-blue-50 p-3 text-sm text-blue-950 space-y-2">
      {approved.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <b>
              {approved.length} approved draft{approved.length === 1 ? "" : "s"} go{approved.length === 1 ? "es" : ""} straight to eBay
            </b>
            <span className="text-blue-900/70">(single cards skip Nifty — eBay needs a card condition Nifty can&apos;t send)</span>
            <button
              type="button"
              disabled={!!busy || left(approved).length === 0}
              onClick={() => run(approved)}
              className="ml-auto px-3 py-1.5 rounded bg-blue-800 text-white font-medium disabled:opacity-50"
            >
              {busy ? "Publishing…" : `Publish ${left(approved).length} to eBay`}
            </button>
          </div>
          <ul className="list-disc pl-5 space-y-0.5">{approved.map(row)}</ul>
        </>
      )}
      {fromNifty.length > 0 && (
        <div className={approved.length ? "pt-2 border-t border-blue-200" : ""}>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="underline" onClick={() => setShowNifty(!showNifty)}>
              {fromNifty.length} single card{fromNifty.length === 1 ? "" : "s"} already sent to Nifty, not on eBay
            </button>
            {showNifty && (
              <button
                type="button"
                disabled={!!busy || left(fromNifty).length === 0}
                onClick={() => run(fromNifty)}
                className="ml-auto px-3 py-1.5 rounded border border-blue-800 text-blue-900 font-medium disabled:opacity-50"
              >
                {busy ? "Publishing…" : `Publish ${left(fromNifty).length} to eBay from FIA`}
              </button>
            )}
          </div>
          {showNifty && (
            <>
              <p className="text-blue-900/80 mt-1">
                FIA leaves their Nifty items as they are. Once one is listed from here, don&apos;t also publish or
                import it to eBay in Nifty, or eBay will have it twice.
              </p>
              <ul className="list-disc pl-5 space-y-0.5 mt-1">{fromNifty.map(row)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
