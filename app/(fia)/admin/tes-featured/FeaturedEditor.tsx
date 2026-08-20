"use client";

import { useState } from "react";

const SLOT_COUNT = 6;

export default function FeaturedEditor({
  options,
  initial,
}: {
  options: { value: string; label: string }[];
  initial: string[];
}) {
  const [slots, setSlots] = useState<string[]>(
    Array.from({ length: SLOT_COUNT }, (_, i) => initial[i] ?? "")
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/tes-featured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: slots.filter(Boolean) }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setStatus("Saved — live on the next page load.");
    } catch (err) {
      setStatus(`Failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5 max-w-xl">
      <div className="space-y-3">
        {slots.map((value, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-brand-ink/50 w-12">Slot {i + 1}</span>
            <select
              value={value}
              onChange={(e) =>
                setSlots((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))
              }
              className="flex-1 text-sm border border-brand-ink/15 rounded px-2 py-1.5 bg-brand-paper"
            >
              <option value="">— empty —</option>
              <option value="states">★ Explore by State</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-brand-ink text-brand-paper text-sm px-5 py-2 rounded hover:bg-brand-ink/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {status && <p className="text-sm text-brand-ink/70">{status}</p>}
      </div>
    </div>
  );
}
