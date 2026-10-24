"use client";

import Link from "next/link";
import { useState } from "react";

type Cand = { itemId: string; title: string; price: number; category: string; size: string | null; sizeSource: string | null; policy: string | null };

export function EnvelopeSwitch({ list }: { list: Cand[] }) {
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ batchId: string; queued: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const chosen = list.filter((c) => !skip.has(c.itemId));

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/shipping/envelope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: chosen.map((c) => c.itemId) }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      setDone({ batchId: out.batchId, queued: out.queued });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!list.length) return <p className="text-sm text-brand-ink/60">Nothing to switch: every listing FIA can tell fits an envelope is already on it.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {done ? (
          <p className="text-green-800 text-sm">
            Queued {done.queued}. The Enhance queue switches them over the next few minutes;{" "}
            <Link className="underline" href={`/admin/ebay/enhance/${done.batchId}`}>
              follow the batch (and undo any)
            </Link>
            .
          </p>
        ) : (
          <button type="button" onClick={go} disabled={busy || !chosen.length} className="px-4 py-2 rounded bg-brand-ink text-white text-sm disabled:opacity-50">
            {busy ? "Queuing…" : `Switch ${chosen.length} to Standard Envelope`}
          </button>
        )}
        {skip.size > 0 && !done && <span className="text-xs text-brand-ink/60">{skip.size} unticked — they stay as they are</span>}
        {err && <span className="text-sm text-red-800">{err}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr className="text-left text-brand-ink/50">
              <th className="py-1 pr-2"></th>
              <th className="pr-2">Listing</th>
              <th className="pr-2">Price</th>
              <th className="pr-2">eBay category</th>
              <th className="pr-2">Size (in)</th>
              <th>Now ships</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.itemId} className="border-t border-brand-ink/10 align-top">
                <td className="py-1 pr-2">
                  <input
                    type="checkbox"
                    disabled={!!done}
                    checked={!skip.has(c.itemId)}
                    onChange={(e) => {
                      const n = new Set(skip);
                      if (e.target.checked) n.delete(c.itemId);
                      else n.add(c.itemId);
                      setSkip(n);
                    }}
                  />
                </td>
                <td className="pr-2">
                  <a className="underline" href={`https://www.ebay.com/itm/${c.itemId}`} target="_blank" rel="noreferrer">
                    {c.title.slice(0, 70)}
                  </a>
                </td>
                <td className="pr-2 tabular-nums">${c.price.toFixed(2)}</td>
                <td className="pr-2">{c.category}</td>
                <td className="pr-2">
                  {c.size?.replace("x", "×") ?? "?"} <span className="text-brand-ink/40">{c.sizeSource}</span>
                </td>
                <td className="text-brand-ink/60">{c.policy?.slice(0, 40)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
