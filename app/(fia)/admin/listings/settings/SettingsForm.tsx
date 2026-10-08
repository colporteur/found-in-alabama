"use client";

import { useState } from "react";
import type { WriterSettings } from "@/lib/listings/rules";

export function SettingsForm({ initial, defaults }: { initial: WriterSettings; defaults: WriterSettings }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: WriterSettings) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const out = (await res.json().catch(() => ({}))) as { settings?: WriterSettings; error?: string };
      if (!res.ok || !out.settings) throw new Error(out.error ?? `HTTP ${res.status}`);
      setS(out.settings);
      setMsg("Saved.");
    } catch (err) {
      setMsg(`Not saved: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full border border-brand-ink/20 rounded px-2 py-1 text-sm font-mono";
  const label = "block text-xs uppercase tracking-wider text-brand-ink/50 mb-1";
  const model = (k: "simple" | "general" | "premium", title: string) => (
    <div>
      <label className={label}>{title}</label>
      <input className={input} value={s.models[k]} onChange={(e) => setS({ ...s, models: { ...s.models, [k]: e.target.value } })} />
    </div>
  );
  const num = (k: "maxPhotos" | "retryBelow" | "floor" | "poshmarkFloor", title: string) => (
    <div>
      <label className={label}>{title}</label>
      <input className={input} inputMode="decimal" value={String(s[k])} onChange={(e) => setS({ ...s, [k]: e.target.value as unknown as number })} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <label className={label}>Identify (first look) model</label>
        <input className={input} value={s.identifyModel} onChange={(e) => setS({ ...s, identifyModel: e.target.value })} />
      </div>
      {model("simple", "Simple tier")}
      {model("general", "General tier")}
      {model("premium", "Premium tier")}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {num("maxPhotos", "Photos sent")}
        {num("retryBelow", "Retry below (0–1)")}
        {num("floor", "eBay floor ($)")}
        {num("poshmarkFloor", "Poshmark floor ($)")}
      </div>
      <div className="flex gap-3 items-center">
        <button type="button" disabled={busy} onClick={() => save(s)} className="text-sm px-4 py-2 rounded font-medium bg-brand-ink text-white disabled:opacity-50">
          Save
        </button>
        <button type="button" disabled={busy} onClick={() => save(defaults)} className="text-sm px-3 py-2 rounded border border-brand-ink/20">
          Reset to defaults
        </button>
        {msg && <span className="text-sm text-brand-ink/70">{msg}</span>}
      </div>
    </div>
  );
}
