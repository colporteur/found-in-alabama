"use client";

// Fix requests on one draft (FIX-1): ask Claude to fix it, see what's
// waiting, and check what Claude changed (before → after) — accept or undo.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FixView } from "@/lib/listings/fixes";
import { FixRequest } from "../FixRequest";

const when = (v: string | null) =>
  v ? new Date(v.endsWith("Z") || v.includes("+") ? v : `${v}Z`).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : "";

export function FixPanel({ id, fixes, canAsk }: { id: string; fixes: FixView[]; canAsk: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const open = fixes.filter((f) => f.status === "open");
  const done = fixes.filter((f) => f.status === "done");
  const past = fixes.filter((f) => !["open", "done"].includes(f.status)).slice(0, 5);
  const latestUndoable = fixes.find((f) => ["open", "done", "accepted"].includes(f.status));

  async function act(action: string, fixId: string) {
    if (action === "undo" && !confirm("Put this draft back the way it was before you asked for the fix?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/fixes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, fixId }),
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

  if (!canAsk && !fixes.length) return null;
  return (
    <div className="mb-6 space-y-3">
      {open.map((f) => (
        <div key={f.id} className="rounded-lg border-2 border-orange-500 bg-orange-50 p-3 text-sm">
          <p className="font-semibold text-orange-900">
            <span className="mr-2 rounded bg-orange-600 px-1.5 py-0.5 text-white text-xs">FIX REQUESTED</span>
            Waiting for Claude{f.groupSize > 1 ? ` (one note for ${f.groupSize} drafts)` : ""} · asked {when(f.createdAt)}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{f.note}</p>
          {f.topics.length > 0 && <p className="mt-1 text-xs text-orange-900/70">About: {f.topics.join(", ")}</p>}
          <p className="mt-1 text-xs text-orange-900/70">It can&apos;t be approved until Claude finishes (or you cancel).</p>
          <button type="button" disabled={busy} onClick={() => act("cancel", f.id)} className="mt-2 px-2 py-1 rounded border border-orange-400 text-xs">
            Cancel request
          </button>
        </div>
      ))}
      {done.map((f) => (
        <div key={f.id} className="rounded-lg border-2 border-green-700 bg-green-50 p-3 text-sm">
          <p className="font-semibold text-green-900">
            <span className="mr-2 rounded bg-green-700 px-1.5 py-0.5 text-white text-xs">FIXED BY CLAUDE</span>
            {when(f.doneAt)} — check it
          </p>
          <p className="mt-1 text-green-900/80">
            <b>You asked:</b> {f.note}
          </p>
          <p className="mt-1">
            <b>Claude:</b> {f.summary}
          </p>
          {f.changes.length > 0 ? (
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-green-900/60">
                  <th className="pr-2 py-0.5 w-32">Changed</th>
                  <th className="pr-2 py-0.5">Before</th>
                  <th className="py-0.5">After</th>
                </tr>
              </thead>
              <tbody>
                {f.changes.map((c) => (
                  <tr key={c.field} className="border-t border-green-700/20 align-top">
                    <td className="pr-2 py-1 font-semibold">{c.field}</td>
                    <td className="pr-2 py-1 text-red-800 line-through decoration-red-300 whitespace-pre-wrap">{clip(c.before)}</td>
                    <td className="py-1 text-green-900 whitespace-pre-wrap">{clip(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-xs text-green-900/70">No field changed.</p>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => act("accept", f.id)} className="px-3 py-1 rounded bg-green-700 text-white text-xs font-semibold">
              Looks good
            </button>
            <button
              type="button"
              disabled={busy || latestUndoable?.id !== f.id}
              title={latestUndoable?.id !== f.id ? "Undo the later fix first" : "Put back the text, price, details and photos from before"}
              onClick={() => act("undo", f.id)}
              className="px-3 py-1 rounded border border-green-700 text-xs disabled:opacity-40"
            >
              Undo
            </button>
          </div>
        </div>
      ))}
      {canAsk && !open.length && <FixRequest ids={[id]} compact label="Ask Claude to fix…" />}
      {past.length > 0 && (
        <details className="text-xs text-brand-ink/60">
          <summary className="cursor-pointer">Earlier fixes ({past.length})</summary>
          <ul className="mt-1 space-y-1">
            {past.map((f) => (
              <li key={f.id}>
                {when(f.createdAt)} · <i>{f.status}</i> · {f.note}
                {f.summary ? ` → ${f.summary}` : ""}
                {f.status === "accepted" && latestUndoable?.id === f.id && (
                  <button type="button" disabled={busy} onClick={() => act("undo", f.id)} className="ml-2 underline">
                    undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {msg && <p className="text-sm text-red-800">{msg}</p>}
    </div>
  );
}

function clip(s: string): string {
  return s.length > 600 ? s.slice(0, 600) + "…" : s;
}
