"use client";

// Words the writer used that the item itself doesn't show (the county of a
// town on the card, a building's architect…). They stay in the listing
// unless Todd removes them; keeping or removing is one click each and
// nothing blocks approval.

import { useState } from "react";
import { useRouter } from "next/navigation";

type U = { words: string; basis?: string; decision?: string | null };

export function UnverifiedPanel({ id, items, editable }: { id: string; items: U[]; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!items.length) return null;

  async function decide(index: number, decision: "keep" | "remove") {
    setBusy(index);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/listings/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unverified", index, decision }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const open = items.filter((u) => !u.decision).length;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8 text-sm">
      <h2 className="text-xs uppercase tracking-wider text-amber-900 mb-1">Not shown on the item — your call</h2>
      <p className="text-xs text-amber-900/80 mb-3">
        The writer is confident about these but the item doesn&apos;t print them. They&apos;re in the listing now; keep them or take
        them out.{open === 0 && " All decided."}
      </p>
      <ul className="space-y-2">
        {items.map((u, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-2">
            <strong className={u.decision === "removed" ? "line-through text-brand-ink/40" : ""}>&ldquo;{u.words}&rdquo;</strong>
            {u.basis && <span className="text-brand-ink/70">— {u.basis}</span>}
            {u.decision ? (
              <span className="text-xs text-brand-ink/50">{u.decision === "removed" ? "removed" : "kept"}</span>
            ) : editable ? (
              <span className="flex gap-2">
                <button type="button" onClick={() => decide(i, "keep")} disabled={busy !== null} className="text-xs px-2 py-0.5 rounded border border-brand-ink/30">
                  Keep
                </button>
                <button type="button" onClick={() => decide(i, "remove")} disabled={busy !== null} className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-800">
                  {busy === i ? "Removing…" : "Remove from listing"}
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {msg && <p className="mt-2 text-red-800">{msg}</p>}
    </div>
  );
}
