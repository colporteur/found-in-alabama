"use client";

// Print controls for the pick list: photo / venue toggles, and a Print
// button that waits for every photo (blank boxes otherwise), records the
// packages as "on a pick list", then opens the print dialog.

import { useState } from "react";

function waitForImages(timeoutMs = 30000): Promise<unknown> {
  const imgs = Array.from(document.images).filter((i) => i.src);
  const loads = imgs
    .filter((i) => !(i.complete && i.naturalWidth > 0))
    .map((i) => new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }));
  const decodes = imgs.map((i) => (i.decode ? i.decode().catch(() => undefined) : undefined));
  return Promise.race([Promise.all([...loads, ...decodes]), new Promise((r) => setTimeout(r, timeoutMs))]);
}

export function PrintBar({ ids }: { ids: string[] }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const toggle = (cls: string, on: boolean) => document.getElementById("pick-root")?.classList.toggle(cls, !on);

  async function print() {
    setBusy(true);
    setNote("Loading photos…");
    try {
      await waitForImages();
      const res = await fetch("/api/admin/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pick_printed", ids }),
      });
      setNote(res.ok ? null : "Couldn't record this pick list (printing anyway).");
    } catch {
      setNote("Couldn't record this pick list (printing anyway).");
    } finally {
      setBusy(false);
    }
    window.print();
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-4 mb-6 text-sm">
      <button
        type="button"
        onClick={print}
        disabled={busy || !ids.length}
        className="px-4 py-2 rounded bg-brand-ink text-white hover:bg-brand-ink/80 disabled:opacity-50"
      >
        {busy ? "Loading photos…" : "Print"}
      </button>
      <label className="flex items-center gap-1">
        <input type="checkbox" defaultChecked onChange={(e) => toggle("hide-thumbs", e.target.checked)} /> Photos
      </label>
      <label className="flex items-center gap-1">
        <input type="checkbox" defaultChecked onChange={(e) => toggle("hide-venue", e.target.checked)} /> Venue
      </label>
      {note && <span className="text-brand-ink/60">{note}</span>}
    </div>
  );
}
