"use client";

// Nifty template items (LIST-3): which existing Nifty listing each kind of
// item copies its fixed marketplace settings from.

import { useState } from "react";

export function TemplatesForm({
  initial,
  defaults,
  labels,
}: {
  initial: Record<string, string>;
  defaults: Record<string, string>;
  labels: Record<string, string>;
}) {
  const [t, setT] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(next: Record<string, string>) {
    setMsg(null);
    const res = await fetch("/api/admin/listings/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niftyTemplates: next }),
    });
    const out = (await res.json().catch(() => ({}))) as { niftyTemplates?: Record<string, string>; error?: string };
    if (!res.ok || !out.niftyTemplates) {
      setMsg(`Not saved: ${out.error ?? `HTTP ${res.status}`}`);
      return;
    }
    setT(out.niftyTemplates);
    setMsg("Saved.");
  }

  const input = "w-full border border-brand-ink/20 rounded px-2 py-1 text-sm font-mono";
  return (
    <div className="space-y-3">
      {Object.keys(labels).map((k) => (
        <div key={k}>
          <label className="block text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
            {labels[k]}{" "}
            <a className="normal-case underline" href={`https://app.nifty.ai/inventory/edit/${t[k]}`} target="_blank" rel="noreferrer">
              open in Nifty
            </a>
          </label>
          <input className={input} value={t[k] ?? ""} onChange={(e) => setT({ ...t, [k]: e.target.value })} placeholder="Nifty item id or edit link" />
        </div>
      ))}
      <div className="flex gap-3 items-center">
        <button type="button" onClick={() => save(t)} className="text-sm px-4 py-2 rounded font-medium bg-brand-ink text-white">
          Save templates
        </button>
        <button type="button" onClick={() => save(defaults)} className="text-sm px-3 py-2 rounded border border-brand-ink/20">
          Reset to defaults
        </button>
        {msg && <span className="text-sm text-brand-ink/70">{msg}</span>}
      </div>
    </div>
  );
}
