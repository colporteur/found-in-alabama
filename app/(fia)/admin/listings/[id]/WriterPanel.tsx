"use client";

// Write / rewrite with the listing writer, and the review actions
// (approve, unapprove, send back). Phase LIST-2. Nothing here publishes.

import { useState } from "react";
import { useRouter } from "next/navigation";

const TIER_OPTIONS = [
  { v: "auto", label: "Auto (router picks)" },
  { v: "simple", label: "Simple — inexpensive model" },
  { v: "general", label: "General — mid model" },
  { v: "premium", label: "Premium — strongest model" },
];

export function WriterPanel({
  id,
  status,
  writtenBy,
  reviewNote,
  generationError,
  stale,
  handMode,
}: {
  id: string;
  status: string;
  writtenBy: string | null;
  reviewNote: string | null;
  generationError: string | null;
  stale: boolean;
  handMode: boolean;
}) {
  const router = useRouter();
  const [tier, setTier] = useState("auto");
  const [corrections, setCorrections] = useState(status === "sent_back" ? reviewNote ?? "" : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const canWrite = ["ready", "review", "sent_back"].includes(status) || (status === "generating" && stale);
  const written = !!writtenBy;

  async function post(url: string, body: unknown, label: string) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || out.ok === false) throw new Error(String(out.error ?? `HTTP ${res.status}`));
      return out;
    } catch (err) {
      setMsg((err as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function write() {
    if (writtenBy?.includes("hand") && !confirm("This draft has hand edits. Rewriting replaces the title, description, specifics and price. Go ahead?")) return;
    const out = await post(`/api/admin/listings/${id}/generate`, { tier, corrections: corrections.trim() || undefined }, "write");
    if (out) {
      const conf = typeof out.confidence === "number" ? ` · confidence ${Math.round(out.confidence * 100)}%` : "";
      setMsg(`Written by ${out.model} (${out.tier})${conf} · $${Number(out.costUsd ?? 0).toFixed(3)}`);
    }
    router.refresh();
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    const out = await post(`/api/admin/listings/${id}`, { action, ...extra }, action);
    if (out) router.refresh();
  }

  const btn = "text-sm px-4 py-2 rounded font-medium disabled:opacity-50";
  const input = "w-full border border-brand-ink/20 rounded px-2 py-1 text-sm";

  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-8 space-y-4">
      {status === "generating" && !stale && (
        <p className="text-sm">The writer is working on this one. Refresh in a minute.</p>
      )}
      {generationError && status !== "generating" && (
        <p className="text-sm text-red-800">Last write failed: {generationError}</p>
      )}
      {status === "sent_back" && reviewNote && (
        <p className="text-sm text-brand-ink/80">
          Sent back: <em>{reviewNote}</em>
        </p>
      )}

      {canWrite && (
        <div className="grid gap-3 md:grid-cols-[1fr,2fr,auto] items-end">
          <div>
            <label className="block text-xs uppercase tracking-wider text-brand-ink/50 mb-1">Model</label>
            <select className={input} value={tier} onChange={(e) => setTier(e.target.value)}>
              {TIER_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
              Corrections for the writer (optional — they override everything)
            </label>
            <input
              className={input}
              value={corrections}
              onChange={(e) => setCorrections(e.target.value)}
              placeholder="e.g. It's Gadsden, not Anniston; postmarked 1912"
            />
          </div>
          <button type="button" onClick={write} disabled={!!busy} className={`${btn} bg-brand-earth text-white hover:bg-brand-earth/80`}>
            {busy === "write" ? "Writing… (20–90 s)" : written ? "Rewrite" : "Write with AI"}
          </button>
        </div>
      )}
      {canWrite && handMode && !written && (
        <p className="text-xs text-brand-ink/50">
          This item was started as “I’ll write it myself”, so “Write all ready” skips it. You can still ask the writer here.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {["review", "sent_back"].includes(status) && written && (
          <button type="button" onClick={() => act("approve")} disabled={!!busy} className={`${btn} bg-green-800 text-white hover:bg-green-700`}>
            {busy === "approve" ? "Approving…" : "Approve"}
          </button>
        )}
        {status === "approved" && (
          <button type="button" onClick={() => act("unapprove")} disabled={!!busy} className={`${btn} border border-brand-ink/20`}>
            Unapprove
          </button>
        )}
        {["review", "approved"].includes(status) && (
          <>
            <input className={`${input} max-w-sm`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's wrong? (sent back with the draft)" />
            <button type="button" onClick={() => act("send_back", { note })} disabled={!!busy} className={`${btn} border border-brand-ink/20`}>
              Send back
            </button>
          </>
        )}
        {msg && <span className="text-sm text-brand-ink/70">{msg}</span>}
      </div>
      {status === "approved" && (
        <p className="text-xs text-brand-ink/50">Approved. Sending approved drafts to Nifty comes in the next milestone; nothing has been published.</p>
      )}
    </div>
  );
}
