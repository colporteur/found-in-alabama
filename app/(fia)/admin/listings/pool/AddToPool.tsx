"use client";

// "Send to lot pool" (a draft) / "Suggest for a lot" (a live inventory item).
// Picks a forming lot, starts a new one, or just adds it to the pool.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddToPool({
  draftId,
  registryItemId,
  groups,
}: {
  draftId?: string;
  registryItemId?: string;
  groups: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const candidate = !draftId;

  async function add() {
    let newGroup: string | null = null;
    if (target === "__new") {
      newGroup = prompt("Name for the new lot (e.g. St. Louis souvenir brochures)")?.trim() || null;
      if (!newGroup) return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: candidate ? "add_candidate" : "pool_draft",
          draftId,
          registryItemId,
          note: note.trim() || null,
          groupId: target && target !== "__new" ? target : null,
          newGroup,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      setOpen(false);
      setMsg(candidate ? "Added to the lot pool (still listed until you delist it)." : "Set aside in the lot pool — put it in the LOTPOOL bin.");
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-sm">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="px-3 py-2 rounded border border-purple-700 text-purple-900 hover:bg-purple-50">
          {candidate ? "Suggest for a lot…" : "Send to lot pool…"}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded border border-purple-700 bg-purple-50 p-2">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="border border-brand-ink/20 rounded px-2 py-1">
            <option value="">Just add it to the pool</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                Into: {g.name}
              </option>
            ))}
            <option value="__new">Start a new lot…</option>
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" className="border border-brand-ink/20 rounded px-2 py-1" />
          <button type="button" onClick={add} disabled={busy} className="px-3 py-1 rounded bg-purple-700 text-white disabled:opacity-50">
            {busy ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="underline text-brand-ink/60">
            Cancel
          </button>
          {candidate && <span className="text-xs text-amber-900 basis-full">It stays listed until you delist it everywhere (by hand) and tick it on the Lot pool page.</span>}
        </div>
      )}
      {msg && (
        <p className="mt-1 text-brand-ink/70">
          {msg}{" "}
          <Link href="/admin/listings/pool" className="underline">
            Lot pool
          </Link>
        </p>
      )}
    </div>
  );
}
