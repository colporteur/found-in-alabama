"use client";

// Bulk bin / SKU: put one bin on every chosen draft (for when it wasn't typed
// on the Scans page). By default only drafts with no bin change.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BinControl({ selected, shown }: { selected: string[]; shown: string[] }) {
  const router = useRouter();
  const [bin, setBin] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function apply(ids: string[], label: string) {
    const b = bin.trim();
    if (!b) {
      setMsg("Type a bin / SKU first.");
      return;
    }
    if (!confirm(`Set bin "${b}" on ${label}${onlyEmpty ? " (only the ones with no bin yet)" : ", replacing any bin they have"}?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bin", ids, bin: b, onlyEmpty }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      setMsg(
        `Set bin ${out.bin} on ${out.changed}` +
          (out.hadBin ? ` · ${out.hadBin} already had a bin (kept)` : "") +
          (out.skipped ? ` · ${out.skipped} not changeable (in Nifty / published / lot pool)` : "")
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
      <span className="text-brand-ink/60">Bin / SKU</span>
      <input
        value={bin}
        onChange={(e) => setBin(e.target.value)}
        placeholder="e.g. LT334.27"
        className="border border-brand-ink/20 rounded px-2 py-1 font-mono w-36"
      />
      <label className="flex items-center gap-1 text-xs" title="Leave drafts that already have a bin alone">
        <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} /> only drafts with no bin
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
