"use client";

// Synonyms editor + "Rebuild now" for /admin/search.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SearchAdmin({ synonyms }: { synonyms: string }) {
  const router = useRouter();
  const [text, setText] = useState(synonyms);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setNote(null);
    try {
      const res = await fetch("/api/admin/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      setNote(
        body.action === "synonyms"
          ? `Saved ${out.groups} synonym groups — they apply to the next search.`
          : `Rebuilt: ${out.refreshed?.changed ?? 0} updated, ${out.refreshed?.removed ?? 0} removed; ${out.embedded?.embedded ?? 0} given meaning${
              out.embedded?.pending ? ` (${out.embedded.pending} still to go — the cron keeps going)` : ""
            }.${out.embedded?.error ? ` Meaning search: ${out.embedded.error}` : ""}`
      );
      router.refresh();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => post({ action: "rebuild" }, "rebuild")}
          disabled={!!busy}
          className="px-4 py-1.5 rounded border border-brand-ink/30 text-sm hover:border-brand-ink disabled:opacity-50"
        >
          {busy === "rebuild" ? "Rebuilding… (can take a few minutes the first time)" : "Rebuild now"}
        </button>
        {note && <span className="text-sm">{note}</span>}
      </div>
      <div className="rounded border border-brand-ink/15 p-4">
        <h2 className="font-semibold">Synonyms</h2>
        <p className="text-xs text-brand-ink/60 mb-2">
          One group per line, separated by commas. Searching any word or phrase in a group finds all of them (e.g.{" "}
          <code>bham, birmingham</code>). Plurals and word endings are handled already — no need to list them.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          className="w-full font-mono text-sm border border-brand-ink/20 rounded p-2"
        />
        <button
          type="button"
          onClick={() => post({ action: "synonyms", text }, "synonyms")}
          disabled={!!busy}
          className="mt-2 px-4 py-1.5 rounded bg-brand-ink text-white text-sm font-semibold disabled:opacity-50"
        >
          {busy === "synonyms" ? "Saving…" : "Save synonyms"}
        </button>
      </div>
    </div>
  );
}
