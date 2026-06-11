"use client";

// Stale-inventory auto-sale configuration on /admin/ebay/sales.
//
// Sections:
//  1. "Sync all listings" — mirrors the entire active eBay store locally,
//     page by page (client drives the loop; no serverless timeout risk).
//  2. Age chart + quarterly age tiers. Age = SKU date when parseable
//     (survives Nifty recreates; solid bar portion), else listing
//     StartTime (lighter portion).
//  3. Bin chart + bin-range tiers (NA## SKUs). Age tiers claim first;
//     bin sales exclude anything already claimed.

import { useCallback, useEffect, useState } from "react";

type SaleTier = {
  key: string;
  minAgeDays: number;
  discountPercent: number;
  enabled: boolean;
};

type BinTier = {
  key: string;
  minBin: number;
  maxBin: number | null;
  discountPercent: number;
  enabled: boolean;
};

type AgeBucket = {
  label: string;
  minDays: number;
  maxDays: number | null;
  itemCount: number;
  fromSku: number;
};

type BinBucket = {
  label: string;
  minBin: number;
  maxBin: number;
  itemCount: number;
};

function tierLabel(minAgeDays: number): string {
  const months = Math.round(minAgeDays / 30);
  return `${months}+ months`;
}

export default function SaleTiersPanel() {
  const [tiers, setTiers] = useState<SaleTier[] | null>(null);
  const [binTiers, setBinTiers] = useState<BinTier[] | null>(null);
  const [distribution, setDistribution] = useState<AgeBucket[] | null>(null);
  const [binDistribution, setBinDistribution] = useState<BinBucket[] | null>(
    null
  );
  const [syncedListings, setSyncedListings] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "error"; msg: string } | null>(
    null
  );

  const loadData = useCallback(() => {
    return fetch("/api/admin/ebay/sales/tiers")
      .then((r) => r.json())
      .then((data) => {
        if (data.tiers) setTiers(data.tiers);
        if (data.binTiers) setBinTiers(data.binTiers);
        if (data.distribution) setDistribution(data.distribution);
        if (data.binDistribution) setBinDistribution(data.binDistribution);
        if (typeof data.syncedListings === "number")
          setSyncedListings(data.syncedListings);
        if (data.error) setFlash({ kind: "error", msg: data.error });
      })
      .catch((err) =>
        setFlash({
          kind: "error",
          msg: err instanceof Error ? err.message : "Failed to load",
        })
      );
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function patchTier(key: string, patch: Partial<SaleTier>) {
    setTiers((prev) =>
      prev ? prev.map((t) => (t.key === key ? { ...t, ...patch } : t)) : prev
    );
  }

  function patchBinTier(key: string, patch: Partial<BinTier>) {
    setBinTiers((prev) =>
      prev ? prev.map((t) => (t.key === key ? { ...t, ...patch } : t)) : prev
    );
  }

  function addBinTier() {
    setBinTiers((prev) => {
      const list = prev ?? [];
      const maxExisting = Math.max(0, ...list.map((t) => t.maxBin ?? t.minBin));
      return [
        ...list,
        {
          key: `bins-${Date.now()}`,
          minBin: maxExisting + 1,
          maxBin: maxExisting + 50,
          discountPercent: 10,
          enabled: false,
        },
      ];
    });
  }

  function removeBinTier(key: string) {
    setBinTiers((prev) => (prev ? prev.filter((t) => t.key !== key) : prev));
  }

  async function syncAllListings() {
    setSyncProgress("Starting…");
    setFlash(null);
    let page = 1;
    let totalSynced = 0;
    try {
      for (;;) {
        const res = await fetch("/api/admin/ebay/pull-listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageNumber: page, entriesPerPage: 200, full: true }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `HTTP ${res.status} on page ${page}`);
        }
        totalSynced += data.matchedThisPage ?? 0;
        setSyncProgress(
          `Page ${data.pageNumber}/${data.totalPages} — ${totalSynced} listings synced`
        );
        if (!data.hasMore) break;
        page += 1;
      }
      setSyncProgress(null);
      setFlash({ kind: "ok", msg: `Synced ${totalSynced} listings from eBay.` });
      await loadData();
    } catch (err) {
      setSyncProgress(null);
      setFlash({
        kind: "error",
        msg: `Sync stopped on page ${page}: ${err instanceof Error ? err.message : "unknown"}. Re-run to continue — already-synced pages are saved.`,
      });
    }
  }

  async function save() {
    if (!tiers && !binTiers) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/ebay/sales/tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers, binTiers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.tiers) setTiers(data.tiers);
      if (data.binTiers) setBinTiers(data.binTiers);
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

  const maxAgeCount = distribution
    ? Math.max(1, ...distribution.map((b) => b.itemCount))
    : 1;
  const maxBinCount = binDistribution
    ? Math.max(1, ...binDistribution.map((b) => b.itemCount))
    : 1;

  return (
    <div className="border border-brand-ink/15 rounded-lg p-5 bg-white mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 className="font-marker text-xl">Automatic stale-inventory sales</h2>
        <div className="flex items-center gap-3">
          {syncedListings !== null && (
            <span className="text-xs text-brand-ink/55">
              {syncedListings.toLocaleString()} listings in local mirror
            </span>
          )}
          <button
            onClick={syncAllListings}
            disabled={!!syncProgress}
            className="text-sm px-3 py-1.5 border border-brand-ink/20 rounded hover:bg-brand-ink/5 transition-colors disabled:opacity-50"
          >
            {syncProgress ?? "Sync all listings"}
          </button>
        </div>
      </div>
      <p className="text-sm text-brand-ink/70 mb-4 max-w-prose">
        Two systems, refreshed weekly, fully automatic. <strong>Age tiers</strong>{" "}
        use each item&rsquo;s true age — the date in its SKU when present
        (solid bar; survives Nifty&rsquo;s listing recreates), else the eBay
        listing date (pale bar). <strong>Bin tiers</strong> catch non-media
        inventory by bin number. Age tiers claim items first; nothing lands in
        two sales.
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

      {/* ── Age section ── */}
      <p className="text-xs uppercase tracking-wider text-brand-ink/55 font-medium mb-2">
        Inventory by true age
      </p>
      {!distribution ? (
        <p className="text-sm text-brand-ink/50 italic mb-6">Loading inventory…</p>
      ) : (
        <div className="mb-4">
          <div className="flex items-end gap-2 h-36">
            {distribution.map((b) => {
              const h = Math.round((b.itemCount / maxAgeCount) * 100);
              const skuShare =
                b.itemCount > 0 ? (b.fromSku / b.itemCount) * 100 : 0;
              return (
                <div
                  key={b.label}
                  className="flex-1 flex flex-col items-center justify-end h-full"
                  title={`${b.itemCount} listings (${b.fromSku} aged by SKU date)`}
                >
                  <span className="text-xs font-medium text-brand-ink/80 mb-1">
                    {b.itemCount.toLocaleString()}
                  </span>
                  <div
                    className="w-full max-w-16 rounded-t bg-brand-yellow/35 relative overflow-hidden"
                    style={{ height: `${Math.max(h, 2)}%` }}
                  >
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-brand-yellow"
                      style={{ height: `${skuShare}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 mt-1 mb-4">
            {distribution.map((b) => (
              <div
                key={b.label}
                className="flex-1 text-center text-xs text-brand-ink/60"
              >
                {b.label}
              </div>
            ))}
          </div>

          {tiers && (
            <div className="border border-brand-ink/10 rounded divide-y divide-brand-ink/10">
              {tiers.map((t) => (
                <div key={t.key} className="flex items-center gap-4 px-3 py-2.5">
                  <label className="flex items-center gap-2 min-w-32">
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      onChange={(e) =>
                        patchTier(t.key, { enabled: e.target.checked })
                      }
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
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Bin section ── */}
      <p className="text-xs uppercase tracking-wider text-brand-ink/55 font-medium mb-2 mt-6">
        Non-media inventory by bin (NA##)
      </p>
      {!binDistribution ? (
        <p className="text-sm text-brand-ink/50 italic mb-4">Loading bins…</p>
      ) : binDistribution.length === 0 ? (
        <p className="text-sm text-brand-ink/50 italic mb-4">
          No NA-bin SKUs found in the mirror yet — run a full sync above.
        </p>
      ) : (
        <div className="mb-4">
          <div className="flex items-end gap-1 h-32 overflow-x-auto">
            {binDistribution.map((b) => {
              const h = Math.round((b.itemCount / maxBinCount) * 100);
              return (
                <div
                  key={b.label}
                  className="flex-1 min-w-10 flex flex-col items-center justify-end h-full"
                  title={`${b.label}: ${b.itemCount} listings`}
                >
                  <span className="text-[10px] font-medium text-brand-ink/80 mb-0.5">
                    {b.itemCount}
                  </span>
                  <div
                    className="w-full rounded-t bg-brand-earth/60"
                    style={{ height: `${Math.max(h, 2)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1 mt-1 mb-4 overflow-x-auto">
            {binDistribution.map((b) => (
              <div
                key={b.label}
                className="flex-1 min-w-10 text-center text-[10px] text-brand-ink/60"
              >
                {b.minBin}–{b.maxBin}
              </div>
            ))}
          </div>

          {binTiers && (
            <div className="border border-brand-ink/10 rounded divide-y divide-brand-ink/10 mb-2">
              {binTiers.map((t) => (
                <div key={t.key} className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      onChange={(e) =>
                        patchBinTier(t.key, { enabled: e.target.checked })
                      }
                      className="accent-brand-yellow w-4 h-4"
                    />
                    <span className="text-sm font-medium">Bins</span>
                  </label>
                  <div className="flex items-center gap-1 text-sm">
                    <span className="text-brand-ink/60">NA</span>
                    <input
                      type="number"
                      min={0}
                      value={t.minBin}
                      onChange={(e) =>
                        patchBinTier(t.key, { minBin: Number(e.target.value) })
                      }
                      className="w-20 px-2 py-1 border border-brand-ink/20 rounded text-right focus:outline-none focus:ring-2 focus:ring-brand-yellow"
                    />
                    <span className="text-brand-ink/60">to NA</span>
                    <input
                      type="number"
                      min={0}
                      value={t.maxBin ?? ""}
                      placeholder="∞"
                      onChange={(e) =>
                        patchBinTier(t.key, {
                          maxBin:
                            e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className="w-20 px-2 py-1 border border-brand-ink/20 rounded text-right focus:outline-none focus:ring-2 focus:ring-brand-yellow"
                    />
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <input
                      type="number"
                      min={1}
                      max={80}
                      value={t.discountPercent}
                      onChange={(e) =>
                        patchBinTier(t.key, {
                          discountPercent: Number(e.target.value),
                        })
                      }
                      className="w-16 px-2 py-1 border border-brand-ink/20 rounded text-right focus:outline-none focus:ring-2 focus:ring-brand-yellow"
                    />
                    <span className="text-brand-ink/60">% off</span>
                  </div>
                  <button
                    onClick={() => removeBinTier(t.key)}
                    className="text-xs text-red-700 hover:underline ml-auto"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={addBinTier}
            className="text-sm px-3 py-1.5 border border-brand-ink/20 rounded hover:bg-brand-ink/5 transition-colors"
          >
            + Add bin range
          </button>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-brand-ink/10">
        <button
          onClick={save}
          disabled={busy}
          className="text-sm px-4 py-2 bg-brand-yellow text-brand-ink font-medium rounded hover:bg-brand-yellow-dark transition-colors disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save all tiers"}
        </button>
      </div>
    </div>
  );
}
