"use client";

// Stale-inventory auto-sale configuration on /admin/ebay/sales.
//
// Top: "Sync all listings" pulls the ENTIRE active eBay store into the
// local ebay_listings mirror page by page (the client drives the loop so
// no single request risks the serverless timeout). Middle: a bar chart
// of active inventory by age quarter, based on each listing's eBay
// StartTime. Bottom: the discount tiers — age threshold, percent off,
// enabled toggle. The weekly cron reads these and maintains one live
// markdown sale per enabled tier.

import { useCallback, useEffect, useState } from "react";

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
};

function tierLabel(minAgeDays: number): string {
  const months = Math.round(minAgeDays / 30);
  return `${months}+ months`;
}

export default function SaleTiersPanel() {
  const [tiers, setTiers] = useState<SaleTier[] | null>(null);
  const [distribution, setDistribution] = useState<AgeBucket[] | null>(null);
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
        if (data.distribution) setDistribution(data.distribution);
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

  async function syncAllListings() {
    setSyncProgress("Starting…");
    setFlash(null);
    let page = 1;
    let totalSynced = 0;
    try {
      // Client-driven pagination: one serverless call per page so no
      // single request can hit the 60s function limit. ~7000 listings at
      // 200/page ≈ 35 requests.
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
        Active inventory by listing age (from each listing&rsquo;s eBay start
        date). Listings older than an enabled tier go into a rolling 30-day
        markdown at that tier&rsquo;s discount — refreshed weekly, fully
        automatic. Run a sync periodically so the mirror tracks new and sold
        listings.
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
                  title={`${b.itemCount} listings`}
                >
                  <span className="text-xs font-medium text-brand-ink/80 mb-1">
                    {b.itemCount.toLocaleString()}
                  </span>
                  <div
                    className="w-full max-w-16 rounded-t bg-brand-yellow"
                    style={{ height: `${Math.max(h, 2)}%` }}
                  />
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
                  listings {t.minAgeDays}–
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
