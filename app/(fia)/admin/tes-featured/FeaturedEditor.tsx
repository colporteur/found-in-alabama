"use client";

import { useState } from "react";
import type { RawSlot } from "@/lib/tes/featured";

const SLOT_COUNT = 6;
const GROUP = "__group__";

type Option = { value: string; label: string };

function slotKind(slot: RawSlot | ""): string {
  if (slot === "") return "";
  if (typeof slot === "object") return GROUP;
  return slot; // "states" or "cat:..."
}

export default function FeaturedEditor({
  options,
  initial,
}: {
  options: Option[];
  initial: RawSlot[];
}) {
  const [slots, setSlots] = useState<(RawSlot | "")[]>(
    Array.from({ length: SLOT_COUNT }, (_, i) => initial[i] ?? "")
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function setSlot(i: number, value: RawSlot | "") {
    setSlots((prev) => prev.map((s, j) => (j === i ? value : s)));
  }

  function onKindChange(i: number, kind: string) {
    if (kind === GROUP) setSlot(i, { name: "", categoryIds: [] });
    else setSlot(i, kind as RawSlot | "");
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const payload = slots.filter((s): s is RawSlot => {
        if (s === "") return false;
        if (typeof s === "object")
          return s.name.trim() !== "" && s.categoryIds.length > 0;
        return true;
      });
      const res = await fetch("/api/admin/tes-featured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: payload }),
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
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5 max-w-2xl">
      <div className="space-y-4">
        {slots.map((slot, i) => {
          const kind = slotKind(slot);
          const group = typeof slot === "object" ? slot : null;
          return (
            <div key={i} className="border border-brand-ink/10 rounded-md p-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-brand-ink/50 w-12">
                  Slot {i + 1}
                </span>
                <select
                  value={kind}
                  onChange={(e) => onKindChange(i, e.target.value)}
                  className="flex-1 text-sm border border-brand-ink/15 rounded px-2 py-1.5 bg-brand-paper"
                >
                  <option value="">— empty —</option>
                  <option value="states">★ Explore by State</option>
                  <option value={GROUP}>✦ Custom group…</option>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {group && (
                <div className="mt-3 ml-12 space-y-2">
                  <input
                    type="text"
                    value={group.name}
                    onChange={(e) =>
                      setSlot(i, { ...group, name: e.target.value })
                    }
                    placeholder='Group name, e.g. "Collectible Niches"'
                    maxLength={40}
                    className="w-full text-sm border border-brand-ink/15 rounded px-2 py-1.5 bg-brand-paper"
                  />
                  <p className="text-xs text-brand-ink/50">
                    Members (Ctrl-click to select several — each becomes a
                    dropdown entry):
                  </p>
                  <select
                    multiple
                    size={10}
                    value={group.categoryIds.map((id) => `cat:${id}`)}
                    onChange={(e) =>
                      setSlot(i, {
                        ...group,
                        categoryIds: [...e.target.selectedOptions].map((o) =>
                          o.value.replace(/^cat:/, "")
                        ),
                      })
                    }
                    className="w-full text-sm border border-brand-ink/15 rounded px-2 py-1.5 bg-brand-paper"
                  >
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-brand-ink/50">
                    {group.categoryIds.length} selected
                  </p>
                </div>
              )}
            </div>
          );
        })}
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
