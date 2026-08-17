"use client";

import { useState } from "react";

type Category = { categoryId: string; name: string; isLeaf?: boolean };

type Subcategory = {
  name: string;
  estimatedCount: number;
  exampleTitles: string[];
  matchHints: string[];
  rationale: string;
};

type AnalysisResult = {
  categoryName: string | null;
  keyword: string | null;
  sampleSize: number;
  costUsd: number;
  proposal: { subcategories: Subcategory[]; notes?: string };
};

export default function SubcategoryAnalyzer({
  categories,
}: {
  categories: Category[];
}) {
  const [categoryId, setCategoryId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [showJson, setShowJson] = useState(false);

  // Distribute panel: fully editable routing rows. Row order = routing
  // order (first match wins), so custom rows added at the top let finer
  // categories (Christmas, Easter) claim items before broad ones.
  type RouteRow = {
    key: string;
    label: string;
    storeCategoryId: string;
    hintsText: string;
  };
  const [rows, setRows] = useState<RouteRow[]>([]);
  const [distributing, setDistributing] = useState(false);
  const [distributeNote, setDistributeNote] = useState<string | null>(null);

  /**
   * Best-effort default: a synced category whose name matches the
   * proposal. Two subtleties:
   * - Only LEAF categories are candidates. Parents are shown disabled,
   *   but a disabled option can still be the selected value when set
   *   programmatically — which would build a batch where every single
   *   ReviseItem fails (eBay won't put items in a parent).
   * - `c.name` is now a full path ("Postcards › Christmas & New Year's"),
   *   so exact matching compares the LAST segment against the proposal.
   */
  function autoMatch(name: string): string {
    const norm = (s: string) =>
      s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, "").trim();
    const leafOf = (s: string) => s.split("›").pop() ?? s;
    const n = norm(name);
    const pool = categories.filter((c) => c.isLeaf !== false);
    const hit =
      pool.find((c) => norm(leafOf(c.name)) === n) ??
      pool.find((c) => norm(c.name).includes(n));
    return hit?.categoryId ?? "";
  }

  async function distribute(routeRows: RouteRow[]) {
    if (!result) return;
    const assignments = routeRows
      .filter((r) => r.storeCategoryId)
      .map((r) => ({
        storeCategoryId: r.storeCategoryId,
        hints: r.hintsText.split(",").map((h) => h.trim()).filter(Boolean),
        label: r.label,
      }));
    if (assignments.length === 0) {
      setError("Map at least one row to a real store category first.");
      return;
    }
    if (
      !confirm(
        `Create ${assignments.length} distribution batch(es)? Items route by title keywords, first match wins, and run on the enhance queue (with rollback).`
      )
    )
      return;
    setDistributing(true);
    setError(null);
    setDistributeNote(null);
    try {
      const res = await fetch("/api/admin/ebay/redistribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(categoryId ? { categoryId } : {}),
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          assignments,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Distribute failed (${res.status})`);
        return;
      }
      fetch("/api/cron/enhance").catch(() => {}); // kick the queue
      const lines = (data.batches as Array<{ name: string; matched: number }>)
        .map((b) => `${b.name}: ${b.matched}`)
        .join(" · ");
      setDistributeNote(
        `Batches created — ${lines}. Leftovers: ${data.leftovers}. ${data.note ?? ""} Watch progress on the Expert Enhance dashboard.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Distribute failed");
    } finally {
      setDistributing(false);
    }
  }

  async function analyze() {
    if (!categoryId && !keyword.trim()) {
      setError("Pick a category, enter a keyword, or both.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/ebay/subcategory-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(categoryId ? { categoryId } : {}),
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        }),
      });
      // Vercel timeouts return plain text, not JSON — surface them sanely.
      const raw = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw);
      } catch {
        setError(
          res.status === 504 || raw.startsWith("An error")
            ? "The analysis timed out on the server — try again (results vary with load)."
            : `Unexpected response (${res.status}): ${raw.slice(0, 120)}`
        );
        return;
      }
      if (!res.ok) {
        setError((data.error as string) ?? `Analysis failed (${res.status})`);
        return;
      }
      const analysis = data as AnalysisResult;
      setResult(analysis);
      // Seed editable routing rows from the proposal.
      setRows(
        (analysis.proposal.subcategories ?? []).map((s, i) => ({
          key: `p${i}`,
          label: s.name,
          storeCategoryId: autoMatch(s.name),
          hintsText: (s.matchHints ?? []).join(", "),
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "border border-brand-ink/20 rounded px-2 py-1.5 text-sm bg-white";

  return (
    <div>
      <div className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-6 flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
            Store category
          </label>
          <select
            className={`${inputCls} min-w-56`}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">(none — keyword only)</option>
            {categories.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
            Keyword (also catches strays in Other)
          </label>
          <input
            className={`${inputCls} min-w-48`}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="postcard"
          />
        </div>
        <button
          onClick={analyze}
          disabled={busy}
          className="bg-brand-ink text-brand-paper hover:bg-brand-ink/85 rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {busy ? "Analyzing titles… (~20-30s)" : "Analyze"}
        </button>
        {error && <span className="text-sm text-red-700">{error}</span>}
      </div>

      {result && (
        <div>
          <p className="text-sm text-brand-ink/60 mb-4">
            {result.sampleSize.toLocaleString()} titles analyzed
            {result.categoryName ? ` from “${result.categoryName}”` : ""}
            {result.keyword ? ` + “${result.keyword}” matches` : ""} · analysis
            cost ${result.costUsd.toFixed(2)}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {result.proposal.subcategories?.map((s) => (
              <div key={s.name} className="bg-white border border-brand-ink/15 rounded-lg p-4">
                <div className="flex items-baseline justify-between mb-1">
                  <p className="font-medium">{s.name}</p>
                  <span className="text-sm text-brand-ink/50">
                    ~{s.estimatedCount}
                  </span>
                </div>
                <p className="text-xs text-brand-ink/60 mb-2">{s.rationale}</p>
                <ul className="text-xs text-brand-ink/70 space-y-0.5 mb-2">
                  {s.exampleTitles?.slice(0, 3).map((t) => (
                    <li key={t} className="truncate">· {t}</li>
                  ))}
                </ul>
                <p className="text-xs font-mono text-brand-ink/50">
                  {s.matchHints?.join(", ")}
                </p>
              </div>
            ))}
          </div>
          {result.proposal.notes && (
            <p className="text-sm text-brand-ink/60 mt-4 max-w-2xl">
              {result.proposal.notes}
            </p>
          )}
          {/* ── Distribute panel ── */}
          <div className="bg-white border border-brand-ink/15 rounded-lg p-4 mt-6">
            <p className="font-medium mb-1">Distribute into real categories</p>
            <p className="text-xs text-brand-ink/50 mb-3 max-w-2xl">
              Rows route TOP TO BOTTOM, first keyword match wins — put fine
              categories (Christmas, Easter) above broad ones. Edit the
              keywords freely; add rows for categories you created that the
              proposal didn&rsquo;t suggest. A row with no keywords is a
              catch-all (claims everything left — keep it last). Blank
              category = row skipped. Runs as normal batches: queued,
              tracked, rollback-able.
            </p>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={r.key} className="flex items-center gap-2 flex-wrap">
                  <select
                    className="border border-brand-ink/20 rounded px-2 py-1 text-sm w-56"
                    value={r.storeCategoryId}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x) =>
                          x.key === r.key
                            ? { ...x, storeCategoryId: e.target.value }
                            : x
                        )
                      )
                    }
                  >
                    <option value="">(skip — pick category)</option>
                    {categories.map((c) => (
                      <option
                        key={c.categoryId}
                        value={c.categoryId}
                        disabled={c.isLeaf === false}
                      >
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="border border-brand-ink/20 rounded px-2 py-1 text-sm flex-1 min-w-64 font-mono"
                    value={r.hintsText}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x) =>
                          x.key === r.key ? { ...x, hintsText: e.target.value } : x
                        )
                      )
                    }
                    placeholder="routing keywords, comma-separated (empty = catch-all)"
                    title={`Proposed as: ${r.label}`}
                  />
                  <button
                    onClick={() =>
                      setRows((prev) => {
                        const idx = prev.findIndex((x) => x.key === r.key);
                        if (idx <= 0) return prev;
                        const next = [...prev];
                        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                        return next;
                      })
                    }
                    disabled={i === 0}
                    className="text-xs border border-brand-ink/25 rounded px-2 py-1 disabled:opacity-30"
                    title="Move up (routes earlier)"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() =>
                      setRows((prev) => prev.filter((x) => x.key !== r.key))
                    }
                    className="text-xs border border-brand-ink/25 rounded px-2 py-1 text-red-700"
                    title="Remove row"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <button
                onClick={() =>
                  setRows((prev) => [
                    {
                      key: `c${Date.now()}`,
                      label: "Custom",
                      storeCategoryId: "",
                      hintsText: "",
                    },
                    ...prev,
                  ])
                }
                className="bg-white border border-brand-ink/30 hover:border-brand-ink rounded px-3 py-2 text-sm"
              >
                + Add row (routes first)
              </button>
              <button
                onClick={() => void distribute(rows)}
                disabled={distributing}
                className="bg-brand-ink text-brand-paper hover:bg-brand-ink/85 rounded px-4 py-2 text-sm disabled:opacity-50"
              >
                {distributing ? "Creating batches…" : "Create distribution batches"}
              </button>
              {distributeNote && (
                <span className="text-xs text-brand-ink/60">{distributeNote}</span>
              )}
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={() => setShowJson((v) => !v)}
              className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
            >
              {showJson ? "Hide" : "Show"} JSON (for the extension config)
            </button>
            {showJson && (
              <pre className="text-xs bg-white border border-brand-ink/15 rounded-lg p-4 mt-2 overflow-x-auto">
                {JSON.stringify(result.proposal, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
