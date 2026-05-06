"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CachedListing } from "./page";

interface PullResult {
  ok: boolean;
  matched?: number;
  inserted?: number;
  otherCategoryName?: string;
  error?: string;
  durationMs?: number;
}

export default function PullListingsCard({
  otherCategory,
  cachedTotal,
  sample,
}: {
  otherCategory: { categoryId: string; name: string } | null;
  cachedTotal: number;
  sample: CachedListing[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pulling, setPulling] = useState(false);
  const [result, setResult] = useState<PullResult | null>(null);
  const [maxItems, setMaxItems] = useState<string>("");

  async function runPull() {
    setPulling(true);
    setResult(null);
    try {
      const body: { maxItems?: number } = {};
      const parsed = parseInt(maxItems, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        body.maxItems = parsed;
      }
      const res = await fetch("/api/admin/ebay/pull-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as PullResult;
      setResult(json);
      if (json.ok) {
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setPulling(false);
    }
  }

  if (!otherCategory) {
    return (
      <div className="bg-white border border-dashed border-brand-ink/30 rounded-lg p-5">
        <p className="font-medium mb-1">No &ldquo;Other&rdquo; bucket selected.</p>
        <p className="text-sm text-brand-ink/70">
          Open Step 1 (Store categories), find your bucket, and toggle{" "}
          <em>Is &ldquo;Other&rdquo;</em> on. Once a category is flagged, this
          step will be unlocked.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-medium text-lg">Pull from eBay</h2>
            <p className="text-sm text-brand-ink/70 mt-1">
              Filtering against:{" "}
              <span className="font-medium">{otherCategory.name}</span>{" "}
              <span className="text-brand-ink/40">
                #{otherCategory.categoryId}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={runPull}
            disabled={pulling}
            className="bg-brand-ink text-brand-paper text-sm px-4 py-2 rounded hover:bg-brand-ink/90 disabled:opacity-50"
          >
            {pulling
              ? "Pulling…"
              : cachedTotal === 0
              ? "Run first pull"
              : "Re-pull"}
          </button>
        </div>

        <details className="text-sm text-brand-ink/70">
          <summary className="cursor-pointer text-brand-ink/60 hover:text-brand-ink">
            Advanced: limit how many to fetch
          </summary>
          <div className="mt-2 flex items-center gap-2">
            <label htmlFor="maxItems" className="text-xs">
              Max items (blank = all):
            </label>
            <input
              id="maxItems"
              type="number"
              min={1}
              value={maxItems}
              onChange={(e) => setMaxItems(e.target.value)}
              placeholder="e.g. 50"
              className="text-sm border border-brand-ink/15 rounded px-2 py-1 w-32 bg-brand-paper focus:outline-none focus:border-brand-yellow"
            />
            <span className="text-xs text-brand-ink/50">
              Useful for a smoke test if your store has thousands of listings.
            </span>
          </div>
        </details>

        {result && result.ok && (
          <div className="mt-3 border-l-4 border-brand-yellow bg-brand-yellow/10 p-3 text-sm">
            ✅ Cached {result.matched} listings in {result.durationMs} ms.
          </div>
        )}
        {result && !result.ok && (
          <div className="mt-3 border-l-4 border-red-500 bg-red-50 p-3 text-sm">
            ❌ {result.error}
          </div>
        )}

        <p className="text-xs text-brand-ink/50 mt-3">
          Tip: GetSellerList scans every active listing and we filter
          client-side, so a store with 5,000+ active listings can take
          1&ndash;2 minutes. If the request times out at the Vercel 60s
          limit, retry with a max-items cap to confirm the basic flow,
          then we&rsquo;ll add resume support.
        </p>
      </div>

      <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-medium text-lg">Cached</h2>
          <p className="font-marker text-2xl">{cachedTotal.toLocaleString()}</p>
        </div>
        {sample.length === 0 ? (
          <p className="text-sm text-brand-ink/50 italic">
            No listings cached yet. Run a pull to populate this table.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-brand-ink/50 border-b border-brand-ink/10">
                <tr>
                  <th className="py-2 pr-3">Image</th>
                  <th className="py-2 pr-3">Title</th>
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Price</th>
                  <th className="py-2 pr-3">Site category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-ink/5">
                {sample.map((l) => (
                  <tr key={l.itemId}>
                    <td className="py-2 pr-3">
                      {l.primaryImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={l.primaryImageUrl}
                          alt=""
                          className="w-10 h-10 object-cover rounded border border-brand-ink/10"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-brand-paper border border-dashed border-brand-ink/20" />
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <a
                        href={`https://www.ebay.com/itm/${l.itemId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline decoration-brand-yellow decoration-2 underline-offset-2"
                        title={l.title}
                      >
                        <span className="line-clamp-2 max-w-md">{l.title}</span>
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-brand-ink/70 font-mono text-xs">
                      {l.sku ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right">{l.quantity ?? "—"}</td>
                    <td className="py-2 pr-3 text-right">
                      {l.price ? `$${l.price}` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-brand-ink/60 text-xs">
                      {l.siteCategoryName ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cachedTotal > sample.length && (
          <p className="text-xs text-brand-ink/50 mt-3">
            Showing {sample.length} most recent of {cachedTotal} cached.
          </p>
        )}
      </div>
    </div>
  );
}
