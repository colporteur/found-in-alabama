"use client";

// Bulk eBay store shelf: put the chosen drafts on one shelf. With "keep the
// place shelf" (on by default) a "Found in Other States" or Alabama shelf
// stays and the other slot changes; otherwise the first shelf is replaced.
// Picking a parent shelf ("Postcards › FIA picks the subcategory") has FIA's
// AI choose the best subcategory under it for each draft, a few at a time.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ShelfControl({
  selected,
  shown,
  shelves,
  parents = [],
}: {
  selected: string[];
  shown: string[];
  shelves: Array<{ id: string; path: string }>;
  parents?: Array<{ id: string; path: string }>;
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
    if (shelf.startsWith("auto:")) return applyAuto(ids, label, shelf.slice(5));
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

  async function applyAuto(ids: string[], label: string, parent: string) {
    const name = parents.find((p) => p.id === parent)?.path ?? parent;
    if (!confirm(`Let FIA pick a "${name}" subcategory for ${label}${keepPlace ? ", keeping their place shelf" : ", replacing their first shelf"}?`)) return;
    setBusy(true);
    const tot = { changed: 0, already: 0, skipped: 0, failed: 0 };
    try {
      for (let i = 0; i < ids.length; i += 8) {
        setMsg(`Picking subcategories… ${i} of ${ids.length}`);
        const res = await fetch("/api/admin/listings/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "auto_shelf", ids: ids.slice(i, i + 8), parent, keepPlace }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
        for (const k of Object.keys(tot) as Array<keyof typeof tot>) tot[k] += Number(out[k] ?? 0);
      }
      setMsg(
        `Moved ${tot.changed} into ${name} subcategories` +
          (tot.already ? ` · ${tot.already} already there` : "") +
          (tot.failed ? ` · ${tot.failed} couldn't be picked (no title yet, or the AI failed)` : "") +
          (tot.skipped ? ` · ${tot.skipped} not editable` : "")
      );
    } catch (err) {
      setMsg(`${(err as Error).message} (after ${tot.changed} moved)`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const btn = "text-sm px-3 py-1.5 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-brand-ink/60">Store shelf</span>
      <select value={shelf} onChange={(e) => setShelf(e.target.value)} className="border border-brand-ink/20 rounded px-2 py-1 max-w-xs">
        <option value="">— pick a shelf —</option>
        {parents.length > 0 && (
          <optgroup label="FIA picks the subcategory">
            {parents.map((p) => (
              <option key={p.id} value={`auto:${p.id}`}>
                {p.path} › (FIA picks)
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Shelves">
          {shelves.map((s) => (
            <option key={s.id} value={s.id}>
              {s.path}
            </option>
          ))}
        </optgroup>
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
