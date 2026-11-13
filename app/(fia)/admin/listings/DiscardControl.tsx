"use client";

// Batch discard: discard every picked draft at once (same as the Discard
// button on a draft's page — photos stay in storage, and a discarded draft
// can be restored from the "Discarded" filter). Approved drafts are skipped;
// unapprove them first. Picked discarded drafts can be restored in a batch.

import { useState } from "react";
import { useRouter } from "next/navigation";

type D = { id: string; status: string };

export function DiscardControl({ drafts, picked, onDone }: { drafts: D[]; picked: Set<string>; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pickedLive = drafts.filter((d) => picked.has(d.id) && d.status !== "discarded").map((d) => d.id);
  const pickedDiscarded = drafts.filter((d) => picked.has(d.id) && d.status === "discarded").map((d) => d.id);

  async function call(action: "discard" | "restore", ids: string[]) {
    if (!ids.length) return;
    if (
      action === "discard" &&
      !confirm(`Discard ${ids.length} draft${ids.length === 1 ? "" : "s"}? Photos stay in storage; you can restore them from the Discarded filter.`)
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      const skipped = (out.skipped ?? []) as Array<{ reason: string }>;
      const reasons = Array.from(new Set(skipped.map((s) => s.reason)));
      setMsg(
        `${action === "discard" ? "Discarded" : "Restored"} ${out.done ?? 0}.` + (skipped.length ? ` Skipped ${skipped.length}: ${reasons.join("; ")}` : "")
      );
      onDone?.();
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!pickedLive.length && !pickedDiscarded.length && !msg) return null;
  const btn = "text-sm px-3 py-1.5 rounded font-medium disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {pickedLive.length > 0 && (
        <button type="button" disabled={busy} onClick={() => call("discard", pickedLive)} className={`${btn} border border-red-800 text-red-800 hover:bg-red-50`}>
          {busy ? "Discarding…" : `Discard selected (${pickedLive.length})`}
        </button>
      )}
      {pickedDiscarded.length > 0 && (
        <button type="button" disabled={busy} onClick={() => call("restore", pickedDiscarded)} className={`${btn} border border-brand-ink/20`}>
          Restore selected ({pickedDiscarded.length})
        </button>
      )}
      {msg && <span className="text-brand-ink/70">{msg}</span>}
    </div>
  );
}
