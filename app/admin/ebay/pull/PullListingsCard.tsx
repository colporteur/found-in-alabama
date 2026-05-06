"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CachedListing } from "./page";

interface PageResult {
  ok: boolean;
  pageNumber?: number;
  totalPages?: number;
  hasMore?: boolean;
  scannedThisPage?: number;
  matchedThisPage?: number;
  otherCategoryName?: string;
  durationMs?: number;
  error?: string;
}

interface PullProgress {
  pagesDone: number;
  totalPages: number;
  scanned: number;
  matched: number;
  status: "idle" | "running" | "stopped" | "done" | "error";
  error?: string;
  lastPageMs?: number;
}

const INITIAL_PROGRESS: PullProgress = {
  pagesDone: 0,
  totalPages: 0,
  scanned: 0,
  matched: 0,
  status: "idle",
};

/**
 * Read fetch response body safely. If the server returned non-JSON (e.g.
 * Vercel's HTML error page on a function timeout), surface the first chunk
 * of that body as the error message instead of throwing a SyntaxError.
 */
async function readJsonOrText<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  const text = await res.text();
  throw new Error(
    `Server returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`
  );
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
  const [progress, setProgress] = useState<PullProgress>(INITIAL_PROGRESS);
  const stopRef = useRef(false);
  const [debug, setDebug] = useState<unknown>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  async function runDebug() {
    setDebug(null);
    setDebugLoading(true);
    try {
      const res = await fetch("/api/admin/ebay/pull-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageNumber: 1, entriesPerPage: 50, debug: true }),
      });
      const json = await readJsonOrText<unknown>(res);
      setDebug(json);
    } catch (err) {
      setDebug({ error: (err as Error).message });
    } finally {
      setDebugLoading(false);
    }
  }

  async function runPull() {
    stopRef.current = false;
    setProgress({ ...INITIAL_PROGRESS, status: "running" });

    let page = 1;
    let totalPages = 0;
    let scanned = 0;
    let matched = 0;

    while (!stopRef.current) {
      try {
        const t0 = Date.now();
        const res = await fetch("/api/admin/ebay/pull-listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageNumber: page, entriesPerPage: 100 }),
        });
        const json = await readJsonOrText<PageResult>(res);

        if (!json.ok) {
          setProgress({
            pagesDone: page - 1,
            totalPages: totalPages || 0,
            scanned,
            matched,
            status: "error",
            error: json.error ?? `HTTP ${res.status}`,
            lastPageMs: Date.now() - t0,
          });
          return;
        }

        totalPages = json.totalPages ?? totalPages;
        scanned += json.scannedThisPage ?? 0;
        matched += json.matchedThisPage ?? 0;

        setProgress({
          pagesDone: page,
          totalPages,
          scanned,
          matched,
          status: "running",
          lastPageMs: Date.now() - t0,
        });

        // Refresh server state every 5 pages so the cached table fills in
        // progressively rather than all at the end.
        if (page % 5 === 0) {
          startTransition(() => router.refresh());
        }

        if (!json.hasMore) {
          setProgress((p) => ({ ...p, status: "done" }));
          startTransition(() => router.refresh());
          return;
        }

        page += 1;
      } catch (err) {
        setProgress({
          pagesDone: page - 1,
          totalPages,
          scanned,
          matched,
          status: "error",
          error: (err as Error).message,
        });
        return;
      }
    }

    // Loop exited because user clicked Stop.
    setProgress((p) => ({ ...p, status: "stopped" }));
    startTransition(() => router.refresh());
  }

  function stopPull() {
    stopRef.current = true;
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

  const isRunning = progress.status === "running";
  const pct =
    progress.totalPages > 0
      ? Math.min(100, Math.round((progress.pagesDone / progress.totalPages) * 100))
      : 0;

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
          {isRunning ? (
            <button
              type="button"
              onClick={stopPull}
              className="bg-brand-ink/10 text-brand-ink text-sm px-4 py-2 rounded hover:bg-brand-ink/20"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={runPull}
              className="bg-brand-ink text-brand-paper text-sm px-4 py-2 rounded hover:bg-brand-ink/90"
            >
              {cachedTotal === 0 ? "Run first pull" : "Re-pull"}
            </button>
          )}
        </div>

        {progress.status !== "idle" && (
          <>
            <div className="mt-3">
              <div className="flex items-baseline justify-between text-sm mb-1">
                <span className="text-brand-ink/70">
                  Page {progress.pagesDone}
                  {progress.totalPages > 0 ? ` of ${progress.totalPages}` : ""}
                </span>
                <span className="text-brand-ink/60 text-xs">
                  scanned {progress.scanned.toLocaleString()} · matched{" "}
                  {progress.matched.toLocaleString()}
                  {progress.lastPageMs
                    ? ` · ${progress.lastPageMs}ms last page`
                    : ""}
                </span>
              </div>
              <div className="h-2 bg-brand-paper rounded overflow-hidden border border-brand-ink/10">
                <div
                  className="h-full bg-brand-yellow transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {progress.status === "done" && (
              <div className="mt-3 border-l-4 border-brand-yellow bg-brand-yellow/10 p-3 text-sm">
                ✅ Done. Scanned {progress.scanned.toLocaleString()} active
                listings, matched {progress.matched.toLocaleString()} into the
                cache.
              </div>
            )}
            {progress.status === "stopped" && (
              <div className="mt-3 border-l-4 border-brand-ink/30 bg-brand-paper p-3 text-sm">
                ⏸ Stopped at page {progress.pagesDone}. Cached so far:{" "}
                {progress.matched.toLocaleString()}. Click Re-pull to resume —
                already-cached listings get refreshed, not duplicated.
              </div>
            )}
            {progress.status === "error" && (
              <div className="mt-3 border-l-4 border-red-500 bg-red-50 p-3 text-sm">
                ❌ {progress.error}
                <p className="text-xs text-brand-ink/60 mt-2">
                  Cached so far: {progress.matched.toLocaleString()}. You can
                  click Re-pull to retry from page 1; existing rows just get
                  refreshed.
                </p>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-brand-ink/50 mt-4">
          Tip: each page is one Trading API call (~5s). Pull runs page by
          page so it can&rsquo;t hit Vercel&rsquo;s 60s function limit.
          You can Stop at any time and Re-pull to resume.
        </p>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-brand-ink/60 hover:text-brand-ink">
            Debug: inspect page 1 without filtering or writing
          </summary>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={runDebug}
              disabled={debugLoading}
              className="text-xs bg-brand-ink/10 text-brand-ink px-3 py-1.5 rounded hover:bg-brand-ink/20 disabled:opacity-50"
            >
              {debugLoading ? "Inspecting…" : "Run debug fetch"}
            </button>
            {debug != null && (
              <pre className="text-xs bg-brand-paper border border-brand-ink/10 rounded p-3 overflow-x-auto max-h-96">
                {JSON.stringify(debug, null, 2)}
              </pre>
            )}
          </div>
        </details>
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
