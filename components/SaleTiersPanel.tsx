"use client";

// Stale-inventory auto-sale configuration on /admin/ebay/sales.
//
// Top: a bar chart of active inventory by age quarter (with how many of
// each bucket have a usable eBay listing id). Below: the discount tiers
// — age threshold, percent off, enabled toggle. The weekly cron reads
// these and maintains one live markdown sale per enabled tier.

import { useEffect, useState } from "react";

type SaleTier = {
  key: string;
  minAgeDays: number;
  discountPercent: number;
  enabled: boolean;
};

type AgeBucket = {
  label: string;
  minDays: number;
  maxDays: number | null;
  itemCount: number;
  withEbayListing: number;
};

function tierLabel(minAgeDays: number): string {
  const months = Math.round(minAgeDays / 30);
  return `${months}+ months`;
}

export default function SaleTiersPanel() {
  const [tiers, setTiers] = useState<SaleTier[] | null>(null);
  const [distribution, setDistribution] = useState<AgeBucket[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "error"; msg: string } | null>(
    null
  );

  useEffect(() => {
    fetch("/api/admin/ebay/sales/tiers")
      .then((r) => r.json())
      .then((data) => {
        if (data.tiers) setTiers(data.tiers);
        if (data.distribution) setDistribution(data.distribution);
        if (data.error) setFlash({ kind: "error", msg: data.error });
      })
      .catch((err) =>
        setFlash({
          kind: "error",
          msg: err instanceof Error ? err.message : "Failed to load",
        })
      );
  }, []);

  function patchTier(key: string, patch: Partial<SaleTier>) {
    setTiers((prev) =>
      prev ? prev.map((t) => (t.key === key ? { ...t, ...patch } : t)) : prev
    );
  }

  async function save() {
    if (!tiers) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/ebay/sales/tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTiers(data.tiers);
      setFlash({
        kind: "ok",
        msg: "Saved. The weekly job will (re)build sales for enabled tiers.",
      });
    } catch (err) {
      setFlash({
        kind: "error",
        msg: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setBusy(false);
    }
  }

  const maxCount = distribution
    ? Math.max(1, ...distribution.map((b) => b.itemCount))
    : 1;

  return (
    <div className="border border-brand-ink/15 rounded-lg p-5 bg-white mb-8">
      <h2 className="font-marker text-xl mb-1">Automatic stale-inventory sales</h2>
      <p className="text-sm text-brand-ink/70 mb-4 max-w-prose">
        Active inventory by age. Items older than an enabled tier go into a
        rolling 30-day markdown at that tier&rsquo;s discount — refreshed
        weekly, fully automatic. Only items with an eBay listing link can be
        included (darker bar portion).
      </p>

      {flash && (
        <div
          className={`mb-4 rounded p-3 text-sm ${
            flash.kind === "error"
              ? "bg-red-50 border border-red-200 text-red-900"
              : "bg-emerald-50 border border-emerald-200 text-emerald-900"
          }`}
        >
          {flash.msg}
        </div>
      )}

      {/* Age distribution chart */}
      {!distribution ? (
        <p className="text-sm text-brand-ink/50 italic mb-6">Loading inventory…</p>
      ) : (
        <div className="mb-6">
          <div className="flex items-end gap-2 h-40">
            {distribution.map((b) => {
              const h = Math.round((b.itemCount / maxCount) * 100);
              return (
                <div
                  key={b.label}
                  className="flex-1 flex flex-col items-center justify-end h-full"
                  title={`${b.itemCount} items (${b.withEbayListing} with eBay listing)`}
                >
                  <span className="text-xs font-medium text-brand-ink/80 mb-1">
                    {b.itemCount}
                  </span>
                  <div
                    className="w-full max-w-16 rounded-t bg-brand-yellow/40 relative"
                    style={{ height: `${Math.max(h, 2)}%` }}
                  >
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-t bg-brand-yellow"
                      style={{ height: `${b.itemCount > 0 ? (b.withEbayListing / b.itemCount) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 mt-1">
            {distribution.map((b) => (
              <div
                key={b.label}
                className="flex-1 text-center text-xs text-brand-ink/60"
              >
                {b.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tier config */}
      {tiers && (
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/55 font-medium mb-2">
            Discount tiers
          </p>
          <div className="border border-brand-ink/10 rounded divide-y divide-brand-ink/10 mb-3">
            {tiers.map((t) => (
              <div key={t.key} className="flex items-center gap-4 px-3 py-3">
                <label className="flex items-center gap-2 min-w-32">
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) => patchTier(t.key, { enabled: e.target.checked })}
                    className="accent-brand-yellow w-4 h-4"
                  />
                  <span className="text-sm font-medium">
                    {tierLabel(t.minAgeDays)}
                  </span>
                </label>
                <div className="flex items-center gap-1 text-sm">
                  <input
                    type="number"
                    min={1}
                    max={80}
                    value={t.discountPercent}
                    onChange={(e) =>
                      patchTier(t.key, {
                        discountPercent: Number(e.target.value),
                      })
                    }
                    className="w-16 px-2 py-1 border border-brand-ink/20 rounded text-right focus:outline-none focus:ring-2 focus:ring-brand-yellow"
                  />
                  <span className="text-brand-ink/60">% off</span>
                </div>
                <span className="text-xs text-brand-ink/50 ml-auto">
                  items {t.minAgeDays}–
                  {tiers.find((n) => n.minAgeDays > t.minAgeDays)
                    ? `${tiers.find((n) => n.minAgeDays > t.minAgeDays)!.minAgeDays} days`
                    : "∞"}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={save}
            disabled={busy}
            className="text-sm px-4 py-2 bg-brand-yellow text-brand-ink font-medium rounded hover:bg-brand-yellow-dark transition-colors disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save tiers"}
          </button>
        </div>
      )}
    </div>
  );
}
