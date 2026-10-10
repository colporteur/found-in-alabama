"use client";

// Bulk "minimum price": raise every chosen draft priced below $X (or with no
// price) up to $X, ending in .87 by default. Only drafts that can still be
// edited change (ready / to review / sent back); approved ones are skipped.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MinPriceControl({ selected, shown }: { selected: string[]; shown: string[] }) {
  const router = useRouter();
  const [min, setMin] = useState("");
  const [round87, setRound87] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function apply(ids: string[], label: string) {
    const m = Number(min.replace(/[$,]/g, ""));
    if (!(m > 0)) {
      setMsg("Type a minimum price first.");
      return;
    }
    if (!confirm(`Raise ${label} priced under $${m.toFixed(2)} to the minimum?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "min_price", ids, min: m, round87 }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      setMsg(
        `Raised ${out.raised} to $${Number(out.price).toFixed(2)}` +
          (out.alreadyAbove ? ` · ${out.alreadyAbove} already at or above` : "") +
          (out.skipped ? ` · ${out.skipped} not editable (approved / in Nifty / writing)` : "")
      );
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const btn = "text-sm px-3 py-1.5 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-brand-ink/60">Minimum price</span>
      <input
        value={min}
        onChange={(e) => setMin(e.target.value)}
        inputMode="decimal"
        placeholder="$"
        className="w-20 border border-brand-ink/20 rounded px-2 py-1"
      />
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={round87} onChange={(e) => setRound87(e.target.checked)} /> end in .87
      </label>
      <button type="button" disabled={busy || !selected.length} onClick={() => apply(selected, `${selected.length} selected`)} className={btn}>
        Apply to selected ({selected.length})
      </button>
      <button type="button" disabled={busy || !shown.length} onClick={() => apply(shown, `all ${shown.length} shown`)} className={btn}>
        Apply to all shown ({shown.length})
      </button>
      {msg && <span className="text-brand-ink/70">{msg}</span>}
    </div>
  );
}
