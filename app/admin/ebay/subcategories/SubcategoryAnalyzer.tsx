"use client";

import { useState } from "react";

type Category = { categoryId: string; name: string };

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

  // Distribute panel: per proposed subcategory → real store category id.
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [distributing, setDistributing] = useState(false);
  const [distributeNote, setDistributeNote] = useState<string | null>(null);

  /** Best-effort default: a synced category whose name matches the proposal. */
  function autoMatch(name: string): string {
    const n = name.toLowerCase();
    const hit =
      categories.find((c) => c.name.toLowerCase() === n) ??
      categories.find(
        (c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase())
      );
    return hit?.categoryId ?? "";
  }

  async function distribute(map: Record<string, string>) {
    if (!result) return;
    const assignments = result.proposal.subcategories
      .filter((s) => map[s.name])
      .map((s) => ({
        storeCategoryId: map[s.name],
        hints: s.matchHints ?? [],
        label: s.name,
      }));
    if (assignments.length === 0) {
      setError("Map at least one subcategory to a real store category first.");
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
      setResult(data as AnalysisResult);
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
              After creating the subcategories on eBay and running Sync
              categories, map each proposal to its real category and
              distribute. Items route by the keywords above (first match
              wins, top to bottom — leave a mapping blank to skip it). Runs
              as normal batches: queued, tracked, rollback-able.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {result.proposal.subcategories?.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span className="text-sm w-44 truncate" title={s.name}>
                    {s.name}
                  </span>
                  <select
                    className="border border-brand-ink/20 rounded px-2 py-1 text-sm flex-1"
                    value={mapping[s.name] ?? autoMatch(s.name)}
                    onChange={(e) =>
                      setMapping((prev) => ({ ...prev, [s.name]: e.target.value }))
                    }
                  >
                    <option value="">(skip)</option>
                    {categories.map((c) => (
                      <option key={c.categoryId} value={c.categoryId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={() => {
                  // Materialize auto-matches, then distribute with that
                  // exact map (state updates land too late to read back).
                  const next = { ...mapping };
                  for (const s of result.proposal.subcategories ?? []) {
                    if (next[s.name] === undefined) next[s.name] = autoMatch(s.name);
                  }
                  setMapping(next);
                  void distribute(next);
                }}
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
