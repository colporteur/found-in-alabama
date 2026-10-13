"use client";

// Shown on a lot draft: Claude combined several drafts into this one. Lists
// the pieces (and the bins they came from), Claude's reason, and "Split lot"
// to put everything back the way it was.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Part = { draftId: string; title: string | null; bin: string | null; candidate?: { registryItemId: string } };

export function LotPanel({ id, parts, reason, canSplit, fromPool = false }: { id: string; parts: Part[]; reason: string | null; canSplit: boolean; fromPool?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const bins = Array.from(new Set(parts.map((p) => p.bin).filter(Boolean)));

  async function split() {
    if (
      !confirm(
        fromPool
          ? `Put this lot back in the lot pool? The lot's text is cleared and its ${parts.length} pieces wait in the pool again.`
          : `Split this lot back into ${parts.length} drafts? The lot's title, description and price are cleared; every piece goes back to Ready.`
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/listings/${id}/lot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "split" }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border-2 border-purple-700 bg-purple-50 p-4 text-sm">
      <p className="font-bold text-purple-900">
        <span className="mr-2 rounded bg-purple-700 px-1.5 py-0.5 text-white">LOT of {parts.length}</span>
        Claude combined these drafts into one listing — give it a careful look.
      </p>
      {reason && <p className="mt-2 text-purple-900/80">Why: {reason}</p>}
      <ol className="mt-2 list-decimal pl-5 text-purple-900/90">
        {parts.map((p, i) => (
          <li key={p.draftId}>
            {p.candidate ? (
              <Link href={`/admin/inventory/${p.candidate.registryItemId}`} className="underline">{p.title ?? "item"}</Link>
            ) : p.draftId === id || !p.draftId ? (
              p.title ?? "item"
            ) : (
              <Link href={`/admin/listings/${p.draftId}`} className="underline">{p.title ?? "item"}</Link>
            )}
            {p.candidate && <span className="ml-1 text-xs">(was listed on its own — pull it from its old bin)</span>}
            {p.bin && <span className="ml-1 font-mono text-xs">(bin {p.bin})</span>}
          </li>
        ))}
      </ol>
      {fromPool && (
        <p className="mt-2 text-purple-900/80">
          From the lot pool: the pooled pieces are in the <span className="font-mono">LOTPOOL</span> bin. Give the lot its own bin below and put
          every piece there.
        </p>
      )}
      {!fromPool && bins.length > 1 && (
        <p className="mt-2 text-purple-900/80">
          The pieces came from bins {bins.join(", ")}; the lot keeps bin <span className="font-mono">{bins[0]}</span> — put them together there.
        </p>
      )}
      {canSplit && (
        <button type="button" onClick={split} disabled={busy} className="mt-3 rounded border border-purple-700 px-3 py-1.5 text-purple-900 hover:bg-purple-100 disabled:opacity-50">
          {busy ? "Splitting…" : fromPool ? "Put back in the lot pool" : "Split lot"}
        </button>
      )}
      {msg && <p className="mt-2 text-red-800">{msg}</p>}
    </div>
  );
}
