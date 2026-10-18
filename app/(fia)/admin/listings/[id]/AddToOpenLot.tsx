"use client";

// "Add to an open lot…" on a draft's page: put this piece into a lot Todd is
// holding open (lib/listings/open-lots.ts). The lot closes and goes back to
// Claude to rewrite for all its pieces.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddToOpenLot({ draftId, lots }: { draftId: string; lots: Array<{ id: string; title: string; pieces: number }> }) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function add() {
    const lot = lots.find((l) => l.id === target);
    if (!lot || !confirm(`Add this piece to "${lot.title}"? The lot closes and goes back to Claude to rewrite for ${lot.pieces + 1} pieces.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/listings/${lot.id}/lot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", draftIds: [draftId] }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      router.push(`/admin/listings/${lot.id}`);
    } catch (err) {
      setMsg((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-teal-700 bg-teal-50 px-3 py-2 text-sm text-teal-900">
      <span className="font-semibold">Add to an open lot:</span>
      <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded border border-teal-700/40 px-2 py-1 max-w-[22rem]">
        <option value="">— pick a lot —</option>
        {lots.map((l) => (
          <option key={l.id} value={l.id}>
            {l.title.slice(0, 70)} ({l.pieces} pieces)
          </option>
        ))}
      </select>
      <button type="button" onClick={add} disabled={busy || !target} className="rounded bg-teal-700 px-3 py-1 text-white disabled:opacity-40">
        {busy ? "Adding…" : "Add"}
      </button>
      {msg && <span className="text-red-800">{msg}</span>}
    </div>
  );
}
