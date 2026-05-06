"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StoredCategory } from "./page";

interface SyncResult {
  ok: boolean;
  totalCount?: number;
  topLevelCount?: number;
  otherDetected?: string[];
  error?: string;
  durationMs?: number;
}

type Filter = "all" | "alabama" | "other" | "unflagged";

export default function CategoriesEditor({
  initial,
}: {
  initial: StoredCategory[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [categories, setCategories] = useState<StoredCategory[]>(initial);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  const lastSyncIso = useMemo(() => {
    if (categories.length === 0) return null;
    return categories.reduce((a, b) =>
      a.lastSyncedAt > b.lastSyncedAt ? a : b
    ).lastSyncedAt;
  }, [categories]);

  // Build a parent → children index for tree-aware rendering.
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, StoredCategory[]>();
    for (const c of categories) {
      const arr = map.get(c.parentCategoryId) ?? [];
      arr.push(c);
      map.set(c.parentCategoryId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    }
    return map;
  }, [categories]);

  const flat = useMemo(() => {
    // Walk the tree depth-first and produce a flat list with depth info.
    const out: Array<{ cat: StoredCategory; depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      const kids = childrenOf.get(parentId) ?? [];
      for (const c of kids) {
        out.push({ cat: c, depth });
        walk(c.categoryId, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [childrenOf]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return flat.filter(({ cat }) => {
      if (q && !cat.name.toLowerCase().includes(q)) return false;
      if (filter === "alabama" && !cat.isAlabamaRelated) return false;
      if (filter === "other" && !cat.isOtherBucket) return false;
      if (filter === "unflagged" && (cat.isAlabamaRelated || cat.isOtherBucket))
        return false;
      return true;
    });
  }, [flat, filter, search]);

  const counts = useMemo(
    () => ({
      total: categories.length,
      alabama: categories.filter((c) => c.isAlabamaRelated).length,
      other: categories.find((c) => c.isOtherBucket) ?? null,
    }),
    [categories]
  );

  async function runSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/ebay/sync-categories", {
        method: "POST",
      });
      const json = (await res.json()) as SyncResult;
      setSyncResult(json);
      if (json.ok) {
        // Refresh the server component to pick up the new rows.
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setSyncResult({ ok: false, error: (err as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  async function toggleFlag(
    categoryId: string,
    field: "isAlabamaRelated" | "isOtherBucket",
    nextValue: boolean
  ) {
    // Optimistic update.
    setSavingIds((s) => new Set(s).add(categoryId));
    setCategories((prev) =>
      prev.map((c) => {
        if (c.categoryId === categoryId) {
          return { ...c, [field]: nextValue };
        }
        // Single-winner for isOtherBucket: clear it on every other row.
        if (field === "isOtherBucket" && nextValue && c.isOtherBucket) {
          return { ...c, isOtherBucket: false };
        }
        return c;
      })
    );

    try {
      const res = await fetch("/api/admin/ebay/categories/toggle", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, field, value: nextValue }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      // Roll back optimistic update on failure.
      console.error("[categories] toggle failed", err);
      setCategories(initial);
      alert(`Failed to save: ${(err as Error).message}`);
    } finally {
      setSavingIds((s) => {
        const next = new Set(s);
        next.delete(categoryId);
        return next;
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Sync card */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h2 className="font-medium text-lg">Sync from eBay</h2>
          <button
            type="button"
            onClick={runSync}
            disabled={syncing}
            className="bg-brand-ink text-brand-paper text-sm px-4 py-2 rounded hover:bg-brand-ink/90 disabled:opacity-50"
          >
            {syncing
              ? "Syncing…"
              : categories.length === 0
              ? "Run first sync"
              : "Re-sync"}
          </button>
        </div>
        <p className="text-sm text-brand-ink/70">
          Calls eBay&rsquo;s <code>GetStore</code>. Auto-detects Alabama keywords
          and the &ldquo;Other&rdquo; bucket on first insert; subsequent runs
          preserve your manual flag edits.
        </p>
        {lastSyncIso && (
          <p className="text-xs text-brand-ink/50 mt-2">
            Last synced {new Date(lastSyncIso).toLocaleString()}
          </p>
        )}
        {syncResult && syncResult.ok && (
          <div className="mt-3 border-l-4 border-brand-yellow bg-brand-yellow/10 p-3 text-sm">
            ✅ Synced {syncResult.totalCount} categories ({syncResult.topLevelCount} top-level).{" "}
            {syncResult.otherDetected && syncResult.otherDetected.length > 0
              ? `Auto-detected "Other" bucket: ${syncResult.otherDetected.join(", ")}.`
              : "No category named exactly \"Other\" was found — set one manually below."}
          </div>
        )}
        {syncResult && !syncResult.ok && (
          <div className="mt-3 border-l-4 border-red-500 bg-red-50 p-3 text-sm">
            ❌ {syncResult.error}
          </div>
        )}
      </div>

      {categories.length === 0 ? null : (
        <>
          {/* Stats */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Total categories" value={counts.total} />
            <Stat label="Alabama-flagged" value={counts.alabama} />
            <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
              <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
                &ldquo;Other&rdquo; bucket
              </p>
              <p className="font-marker text-xl truncate" title={counts.other?.name}>
                {counts.other?.name ?? "Not set"}
              </p>
              <p className="text-xs text-brand-ink/50 mt-1">
                {counts.other ? "Listings here will be reviewed" : "Pick one below"}
              </p>
            </div>
          </div>

          {/* Filter bar */}
          <div className="bg-white border border-brand-ink/15 rounded-lg p-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {(["all", "alabama", "other", "unflagged"] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`text-xs uppercase tracking-wider px-3 py-1.5 rounded ${
                    filter === f
                      ? "bg-brand-ink text-brand-paper"
                      : "bg-brand-paper text-brand-ink/70 hover:bg-brand-ink/5"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories…"
              className="ml-auto flex-1 min-w-[200px] text-sm border border-brand-ink/15 rounded px-3 py-1.5 bg-brand-paper focus:outline-none focus:border-brand-yellow"
            />
          </div>

          {/* Categories list */}
          <div className="bg-white border border-brand-ink/15 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 bg-brand-paper text-xs uppercase tracking-wider text-brand-ink/50">
              <div>Name</div>
              <div className="text-center">Alabama</div>
              <div className="text-center">Is &ldquo;Other&rdquo;</div>
            </div>
            <ul className="divide-y divide-brand-ink/5">
              {filtered.length === 0 ? (
                <li className="px-4 py-6 text-sm text-brand-ink/50 text-center">
                  No categories match this filter.
                </li>
              ) : (
                filtered.map(({ cat, depth }) => (
                  <li
                    key={cat.categoryId}
                    className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2.5 items-center text-sm"
                  >
                    <div
                      className="truncate"
                      style={{ paddingLeft: `${depth * 1.25}rem` }}
                      title={cat.name}
                    >
                      {depth > 0 && (
                        <span className="text-brand-ink/30 mr-1">↳</span>
                      )}
                      {cat.name}
                      <span className="text-xs text-brand-ink/40 ml-2">
                        #{cat.categoryId}
                      </span>
                    </div>
                    <Toggle
                      checked={cat.isAlabamaRelated}
                      saving={savingIds.has(cat.categoryId)}
                      onChange={(v) =>
                        toggleFlag(cat.categoryId, "isAlabamaRelated", v)
                      }
                      label="Alabama-related"
                    />
                    <Toggle
                      checked={cat.isOtherBucket}
                      saving={savingIds.has(cat.categoryId)}
                      onChange={(v) =>
                        toggleFlag(cat.categoryId, "isOtherBucket", v)
                      }
                      label='"Other" bucket'
                    />
                  </li>
                ))
              )}
            </ul>
          </div>

          <p className="text-xs text-brand-ink/50">
            Showing {filtered.length} of {categories.length}. Changes save as
            you toggle.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
        {label}
      </p>
      <p className="font-marker text-3xl">{value.toLocaleString()}</p>
    </div>
  );
}

function Toggle({
  checked,
  saving,
  onChange,
  label,
}: {
  checked: boolean;
  saving: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={saving}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? "bg-brand-yellow" : "bg-brand-ink/15"
      } ${saving ? "opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
