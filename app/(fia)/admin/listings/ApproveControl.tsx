"use client";

// Batch approval: approve the selected drafts, every draft to review that's
// shown, or unapprove selected approved ones (to edit them again). A draft
// missing a title, description, price or condition is skipped with the
// reason. Approving publishes nothing — the drafts wait for "Send approved
// to Nifty" in the extension.

import { useState } from "react";
import { useRouter } from "next/navigation";

type D = { id: string; status: string };

export function ApproveControl({ drafts, picked, onDone }: { drafts: D[]; picked: Set<string>; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const approvable = new Set(["review", "sent_back", "ready"]);
  const pickedApprovable = drafts.filter((d) => picked.has(d.id) && approvable.has(d.status)).map((d) => d.id);
  const pickedApproved = drafts.filter((d) => picked.has(d.id) && d.status === "approved").map((d) => d.id);
  const allReview = drafts.filter((d) => d.status === "review").map((d) => d.id);

  async function call(action: "approve" | "unapprove", ids: string[], label: string) {
    if (!ids.length) return;
    if (action === "approve" && ids.length > 1 && !confirm(`Approve ${label}?`)) return;
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
      const done = action === "approve" ? out.approved?.length ?? 0 : out.unapproved ?? 0;
      const skipped = (out.skipped ?? []) as Array<{ reason: string }>;
      const reasons = Array.from(new Set(skipped.map((s) => s.reason)));
      setMsg(
        `${action === "approve" ? "Approved" : "Unapproved"} ${done}.` +
          (skipped.length ? ` Skipped ${skipped.length}: ${reasons.join("; ")}` : "")
      );
      onDone?.();
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const btn = "text-sm px-3 py-1.5 rounded font-medium disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        disabled={busy || !pickedApprovable.length}
        onClick={() => call("approve", pickedApprovable, `${pickedApprovable.length} selected`)}
        className={`${btn} bg-green-800 text-white hover:bg-green-700`}
      >
        Approve selected ({pickedApprovable.length})
      </button>
      <button
        type="button"
        disabled={busy || !allReview.length}
        onClick={() => call("approve", allReview, `all ${allReview.length} to review shown`)}
        className={`${btn} border border-green-800 text-green-900 hover:bg-green-50`}
      >
        Approve all to review ({allReview.length})
      </button>
      <button
        type="button"
        disabled={busy || !pickedApproved.length}
        onClick={() => call("unapprove", pickedApproved, `${pickedApproved.length} selected`)}
        className={`${btn} border border-brand-ink/20`}
        title="Back to To review, so they can be edited"
      >
        Unapprove selected ({pickedApproved.length})
      </button>
      {msg && <span className="text-brand-ink/70">{msg}</span>}
    </div>
  );
}
