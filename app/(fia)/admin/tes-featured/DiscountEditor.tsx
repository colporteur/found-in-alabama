"use client";

// Store-wide flat discount control for The Ephemeral State. One number:
// the "always X% below eBay" percentage applied across the storefront,
// checkout, and the Google Merchant feed. 0 turns it off. Never stacks
// with eBay markdown sales — the larger percentage wins per item.

import { useState } from "react";

export default function DiscountEditor({ initial }: { initial: number }) {
  const [value, setValue] = useState(String(initial));
  const [saved, setSaved] = useState<number>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/tes-discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percent: Number(value) }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        percent?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setMsg(data.error ?? "Save failed.");
      } else {
        const pct = data.percent ?? 0;
        setSaved(pct);
        setValue(String(pct));
        setMsg(
          pct > 0
            ? `Saved — the storefront now shows ${pct}% off every item.`
            : "Saved — store-wide discount is off."
        );
      }
    } catch {
      setMsg("Save failed — network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5 max-w-xl">
      <h2 className="font-medium mb-1">Store-wide discount</h2>
      <p className="text-sm text-brand-ink/70 mb-4 leading-relaxed">
        Every TES price becomes this percentage below its eBay price —
        storefront, cart, checkout, and the Google feed. Set 0 to turn it
        off. Items on an eBay markdown sale keep whichever discount is
        bigger (never both).
      </p>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={50}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24 border border-brand-ink/20 rounded-md px-3 py-2 text-sm"
          />
          <span className="text-sm text-brand-ink/70">% off eBay prices</span>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={busy || Number(value) === saved}
          className="px-4 py-2 rounded-md bg-brand-ink text-white text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {msg && <p className="text-sm mt-3 text-brand-ink/80">{msg}</p>}
      <p className="text-xs text-brand-ink/50 mt-3">
        Currently: {saved > 0 ? `${saved}% off store-wide` : "off"} · takes
        effect immediately, no deploy needed.
      </p>
    </div>
  );
}
