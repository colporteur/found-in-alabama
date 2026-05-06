"use client";

import { useState } from "react";

interface TestResult {
  ok: boolean;
  storeName?: string;
  topLevelCategoryCount?: number;
  totalCategoryCount?: number;
  sampleCategoryNames?: string[];
  error?: string;
  durationMs?: number;
}

export default function TestConnectionButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function runTest() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/ebay/test-connection", {
        method: "POST",
      });
      const json = (await res.json()) as TestResult;
      setResult(json);
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-medium text-lg">Test connection</h2>
        <button
          type="button"
          onClick={runTest}
          disabled={loading}
          className="bg-brand-ink text-brand-paper text-sm px-4 py-2 rounded hover:bg-brand-ink/90 disabled:opacity-50"
        >
          {loading ? "Testing…" : "Run test"}
        </button>
      </div>
      <p className="text-sm text-brand-ink/70 mb-4">
        Calls eBay&rsquo;s <code>GetStore</code> Trading API method and reports
        what it sees. No data is written.
      </p>

      {result && result.ok && (
        <div className="border-l-4 border-brand-yellow bg-brand-yellow/10 p-4 text-sm space-y-1">
          <p>
            <span className="text-brand-ink/60">Store name:</span>{" "}
            <span className="font-medium">
              {result.storeName ?? "(no name returned)"}
            </span>
          </p>
          <p>
            <span className="text-brand-ink/60">Top-level categories:</span>{" "}
            {result.topLevelCategoryCount}
          </p>
          <p>
            <span className="text-brand-ink/60">Total categories (incl. nested):</span>{" "}
            {result.totalCategoryCount}
          </p>
          {result.sampleCategoryNames?.length ? (
            <p>
              <span className="text-brand-ink/60">First few:</span>{" "}
              {result.sampleCategoryNames.join(" · ")}
            </p>
          ) : null}
          {typeof result.durationMs === "number" && (
            <p className="text-brand-ink/50 text-xs">
              {result.durationMs} ms
            </p>
          )}
          <p className="pt-2 text-brand-ink/80">
            ✅ Trading API call succeeded.
          </p>
        </div>
      )}

      {result && !result.ok && (
        <div className="border-l-4 border-red-500 bg-red-50 p-4 text-sm">
          <p className="font-medium mb-1">Test failed</p>
          <p className="text-brand-ink/80 break-words">{result.error}</p>
        </div>
      )}
    </div>
  );
}
