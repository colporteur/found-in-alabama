"use client";

// "Ask Claude to fix…" (FIX-1): a note (plus optional topic chips) for one
// draft or every selected draft. Claude sees it first in its queue, changes
// only what the note asks, and the draft comes back with a before/after.

import { useState } from "react";
import { useRouter } from "next/navigation";

const TOPICS = ["title", "description", "price", "specifics", "category", "condition", "photos", "sku/bin", "weight/shipping", "other"];

export function FixRequest({
  ids,
  label,
  compact = false,
  onDone,
}: {
  ids: string[];
  label?: string;
  compact?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!compact);
  const [note, setNote] = useState("");
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const many = ids.length > 1;

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/fixes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", ids, note, topics: Array.from(topics) }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      const n = (out.requested ?? []).length;
      const skipped = (out.skipped ?? []) as Array<{ reason: string }>;
      setMsg(
        `Sent to Claude${many ? ` for ${n} draft${n === 1 ? "" : "s"}` : ""}.` +
          (skipped.length ? ` Skipped ${skipped.length} (${Array.from(new Set(skipped.map((s) => s.reason))).join("; ")}).` : "") +
          " Ask Claude to work the FIA queue — fixes come first."
      );
      setNote("");
      setTopics(new Set());
      if (compact) setOpen(false);
      onDone?.();
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          disabled={!ids.length}
          onClick={() => setOpen(true)}
          className="text-sm px-3 py-1.5 rounded border border-orange-600 text-orange-800 hover:bg-orange-50 disabled:opacity-40"
        >
          {label ?? `Ask Claude to fix${ids.length > 1 ? ` (${ids.length})` : ""}…`}
        </button>
        {msg && <span className="text-sm">{msg}</span>}
      </span>
    );
  }
  return (
    <div className="rounded-lg border-2 border-orange-500 bg-orange-50 p-3 text-sm w-full max-w-3xl">
      <p className="font-semibold text-orange-900 mb-1">
        Ask Claude to fix {many ? `these ${ids.length} drafts (one note for all)` : "this draft"}
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder={many ? "e.g. These are all linen postcards, not chrome — fix titles and specifics." : "e.g. It's 1952, not 1925. Put the back photo second."}
        className="w-full rounded border border-orange-300 bg-white p-2"
      />
      <div className="flex flex-wrap gap-1.5 my-2">
        {TOPICS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() =>
              setTopics((s) => {
                const n = new Set(s);
                if (n.has(t)) n.delete(t);
                else n.add(t);
                return n;
              })
            }
            className={`px-2 py-0.5 rounded-full border text-xs ${topics.has(t) ? "bg-orange-600 text-white border-orange-600" : "border-orange-300 bg-white text-orange-900"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !note.trim() || !ids.length}
          onClick={send}
          className="px-3 py-1.5 rounded bg-orange-600 text-white font-semibold disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send to Claude"}
        </button>
        {compact && (
          <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded border border-orange-300">
            Cancel
          </button>
        )}
        {msg && <span>{msg}</span>}
      </div>
    </div>
  );
}
