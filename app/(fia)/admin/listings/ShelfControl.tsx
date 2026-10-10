"use client";

// Bulk eBay store shelf: put the chosen drafts on one shelf. With "keep the
// place shelf" (on by default) a "Found in Other States" or Alabama shelf
// stays and the other slot changes; otherwise the first shelf is replaced.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ShelfControl({
  selected,
  shown,
  shelves,
}: {
  selected: string[];
  shown: string[];
  shelves: Array<{ id: string; path: string }>;
}) {
  const router = useRouter();
  const [shelf, setShelf] = useState("");
  const [keepPlace, setKeepPlace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function apply(ids: string[], label: string) {
    if (!shelf) {
      setMsg("Pick a shelf first.");
      return;
    }
    const name = shelves.find((s) => s.id === shelf)?.path ?? shelf;
    if (!confirm(`Put ${label} on "${name}"${keepPlace ? ", keeping their place shelf" : ", replacing their first shelf"}?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "store_shelf", ids, shelf, keepPlace }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      setMsg(
        `Moved ${out.changed} to ${out.shelf}` +
          (out.already ? ` · ${out.already} already there` : "") +
          (out.skipped ? ` · ${out.skipped} not editable` : "")
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
      <span className="text-brand-ink/60">Store shelf</span>
      <select value={shelf} onChange={(e) => setShelf(e.target.value)} className="border border-brand-ink/20 rounded px-2 py-1 max-w-xs">
        <option value="">— pick a shelf —</option>
        {shelves.map((s) => (
          <option key={s.id} value={s.id}>
            {s.path}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs" title="A 'Found in Other States' or Alabama shelf stays; the other slot gets the new shelf">
        <input type="checkbox" checked={keepPlace} onChange={(e) => setKeepPlace(e.target.checked)} /> keep the place shelf (Found in
        Other States / Alabama), replace the other
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
