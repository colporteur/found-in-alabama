"use client";

// Drives the auto-categorize loop on the client side. Calls /start to
// snapshot the queue, then /advance repeatedly with a ~2 second pause
// between each item. The results table fills in as items are processed.
// Stop button cancels and stops the loop.

import { useCallback, useEffect, useRef, useState } from "react";

const ADVANCE_INTERVAL_MS = 2000; // pace between items
const STATUS_REFRESH_MS = 3000; // when idle, refresh dashboard every Ns

interface RunSummary {
  id: string;
  phase: "primary" | "secondary";
  status: "running" | "completed" | "failed" | "cancelled";
  initialQueueCount: number;
  queueIndex: number;
  totalApplied: number;
  totalFailed: number;
  totalSkipped: number;
  startedAt: string;
  completedAt: string | null;
}

interface ResultRow {
  id: string;
  itemId: string;
  title: string;
  primaryImageUrl: string | null;
  pickedCategory1Name: string | null;
  pickedCategory2Name: string | null;
  isAlabamaPick: boolean;
  confidence: number | null;
  reasoning: string | null;
  outcome: string;
  errorMessage: string | null;
  decidedAt: string;
}

export default function AutoCategorizeRunner({
  initialRun,
  initialResults,
  otherFlagged,
}: {
  initialRun: RunSummary | null;
  initialResults: ResultRow[];
  otherFlagged: boolean;
}) {
  const [run, setRun] = useState<RunSummary | null>(initialRun);
  const [results, setResults] = useState<ResultRow[]>(initialResults);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"primary" | "secondary">("primary");

  // We track "should I keep advancing?" outside React state so the loop
  // can be cancelled immediately on click without waiting for a re-render.
  const advancingRef = useRef(false);

  const primaryDone =
    initialRun?.status === "completed" &&
    initialRun.phase === "primary" &&
    initialRun.totalSkipped + initialRun.totalApplied + initialRun.totalFailed === initialRun.initialQueueCount;

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/admin/ebay/auto-categorize/status");
    if (!res.ok) return;
    const data = (await res.json()) as {
      run: RunSummary | null;
      categorizations: ResultRow[];
    };
    setRun(data.run);
    setResults(data.categorizations);
  }, []);

  const advanceLoop = useCallback(
    async (runId: string) => {
      advancingRef.current = true;
      while (advancingRef.current) {
        try {
          const res = await fetch(
            "/api/admin/ebay/auto-categorize/advance",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ runId }),
            }
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setError(
              `Advance failed: ${body.error ?? `HTTP ${res.status}`}. Retrying in 5s…`
            );
            await sleep(5000);
            continue;
          }
          const data = (await res.json()) as { done: boolean };
          await fetchStatus();
          if (data.done) {
            advancingRef.current = false;
            break;
          }
        } catch (err) {
          setError(
            `Network error: ${err instanceof Error ? err.message : String(err)}. Retrying in 5s…`
          );
          await sleep(5000);
          continue;
        }
        await sleep(ADVANCE_INTERVAL_MS);
      }
    },
    [fetchStatus]
  );

  const start = useCallback(
    async (selectedPhase: "primary" | "secondary") => {
      setStarting(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/ebay/auto-categorize/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: selectedPhase }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const { runId } = (await res.json()) as { runId: string };
        await fetchStatus();
        // Kick off the advance loop
        void advanceLoop(runId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Start failed");
      } finally {
        setStarting(false);
      }
    },
    [advanceLoop, fetchStatus]
  );

  const stop = useCallback(async () => {
    if (!run) return;
    advancingRef.current = false;
    await fetch("/api/admin/ebay/auto-categorize/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.id }),
    });
    await fetchStatus();
  }, [run, fetchStatus]);

  // If an existing "running" run exists when the page mounts (e.g. user
  // refreshed during a run), resume the advance loop automatically.
  useEffect(() => {
    if (initialRun?.status === "running" && !advancingRef.current) {
      void advanceLoop(initialRun.id);
    }
    // Light background refresh so completed-run state stays current
    const id = setInterval(() => {
      if (!advancingRef.current) void fetchStatus();
    }, STATUS_REFRESH_MS);
    return () => {
      clearInterval(id);
      advancingRef.current = false;
    };
  }, [initialRun, advanceLoop, fetchStatus]);

  const isRunning = run?.status === "running";
  const progress = run
    ? Math.round((run.queueIndex / Math.max(1, run.initialQueueCount)) * 100)
    : 0;
  const eta = run && isRunning
    ? formatEta((run.initialQueueCount - run.queueIndex) * (ADVANCE_INTERVAL_MS + 4000))
    : null;

  return (
    <div className="space-y-8">
      {/* Phase + Start controls */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
          <h2 className="font-medium text-lg">Run categorization</h2>
          {isRunning && (
            <button
              onClick={stop}
              className="text-sm px-3 py-1.5 bg-red-100 text-red-900 rounded hover:bg-red-200"
            >
              Stop
            </button>
          )}
        </div>

        {!isRunning && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="phase"
                  value="primary"
                  checked={phase === "primary"}
                  onChange={() => setPhase("primary")}
                  disabled={!otherFlagged}
                />
                <span>
                  <strong>Primary</strong> — move out of &ldquo;Other&rdquo;
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="phase"
                  value="secondary"
                  checked={phase === "secondary"}
                  onChange={() => setPhase("secondary")}
                  disabled={!primaryDone || !otherFlagged}
                />
                <span>
                  <strong>Secondary</strong> — add a 2nd category{" "}
                  {!primaryDone && (
                    <em className="text-brand-ink/50">
                      (unlocks when Primary completes)
                    </em>
                  )}
                </span>
              </label>
            </div>
            <button
              onClick={() => start(phase)}
              disabled={starting || !otherFlagged}
              className="inline-flex items-center justify-center px-6 py-3 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting
                ? "Snapshotting queue…"
                : `Start ${phase} run →`}
            </button>
            <p className="text-xs text-brand-ink/50">
              Starts immediately. Snapshot may take 10–30 seconds for large
              stores. Once running, items process at ~1 every {Math.round(ADVANCE_INTERVAL_MS / 1000)} seconds with one Claude call + one eBay update each.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-900">
            {error}
          </div>
        )}
      </div>

      {/* Progress + stats */}
      {run && (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
            <p className="text-sm">
              <strong>{capitalize(run.phase)} run</strong> ·{" "}
              <StatusBadge status={run.status} />
              {isRunning && eta && (
                <span className="text-brand-ink/60 ml-2">~{eta} remaining</span>
              )}
            </p>
            <p className="text-xs text-brand-ink/50">
              Started {formatTime(run.startedAt)}
              {run.completedAt && ` · finished ${formatTime(run.completedAt)}`}
            </p>
          </div>

          <div className="w-full h-3 bg-brand-ink/10 rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-brand-yellow transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Processed" value={`${run.queueIndex} / ${run.initialQueueCount}`} />
            <Stat label="Applied" value={String(run.totalApplied)} tone="success" />
            <Stat label="Skipped" value={String(run.totalSkipped)} tone="muted" />
            <Stat label="Failed" value={String(run.totalFailed)} tone="error" />
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="bg-white border border-brand-ink/15 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-brand-ink/10 flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium text-sm">Recent categorizations</p>
            <p className="text-xs text-brand-ink/50">
              {results.length} shown · click any title to open the listing on eBay
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-brand-paper border-b border-brand-ink/10 text-xs uppercase tracking-wider text-brand-ink/60">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 font-medium">Categorized as</th>
                <th className="px-4 py-2 font-medium">Confidence</th>
                <th className="px-4 py-2 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-brand-ink/5 last:border-b-0 hover:bg-brand-paper/50"
                >
                  <td className="px-4 py-3 max-w-md">
                    <a
                      href={`https://www.ebay.com/itm/${r.itemId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline decoration-brand-yellow decoration-2 underline-offset-2 line-clamp-2"
                    >
                      {r.title}
                    </a>
                    <p className="text-xs text-brand-ink/50 mt-1">
                      <a
                        href={`https://www.ebay.com/sl/edit/?ItemID=${r.itemId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-brand-ink"
                      >
                        Edit on eBay →
                      </a>
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {r.pickedCategory1Name ? (
                      <div>
                        <p className="text-sm">
                          {r.isAlabamaPick && (
                            <span className="mr-1 text-xs px-1.5 py-0.5 rounded bg-brand-yellow/40 text-brand-ink">
                              AL
                            </span>
                          )}
                          {r.pickedCategory1Name}
                        </p>
                        {r.pickedCategory2Name && (
                          <p className="text-xs text-brand-ink/60 mt-0.5">
                            + {r.pickedCategory2Name}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-brand-ink/40 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.confidence != null ? (
                      <span
                        className={
                          r.confidence >= 0.7
                            ? "text-brand-ink/80"
                            : r.confidence >= 0.5
                            ? "text-amber-700"
                            : "text-red-700"
                        }
                      >
                        {Math.round(r.confidence * 100)}%
                      </span>
                    ) : (
                      <span className="text-brand-ink/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <OutcomeBadge outcome={r.outcome} />
                    {r.errorMessage && (
                      <p
                        className="text-xs text-brand-ink/50 mt-1 max-w-xs truncate"
                        title={r.errorMessage}
                      >
                        {r.errorMessage}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RunSummary["status"] }) {
  const map: Record<RunSummary["status"], string> = {
    running: "bg-brand-yellow/30 text-brand-ink",
    completed: "bg-emerald-100 text-emerald-900",
    failed: "bg-red-100 text-red-900",
    cancelled: "bg-brand-ink/10 text-brand-ink/70",
  };
  return (
    <span
      className={`text-xs uppercase tracking-wider px-2 py-0.5 rounded ${map[status]}`}
    >
      {status}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    applied: { label: "Applied", cls: "bg-emerald-100 text-emerald-900" },
    ebay_ended: { label: "Item ended", cls: "bg-brand-ink/10 text-brand-ink/60" },
    ebay_failed: { label: "eBay error", cls: "bg-red-100 text-red-900" },
    claude_failed: { label: "Claude error", cls: "bg-red-100 text-red-900" },
    skipped: { label: "No match", cls: "bg-amber-100 text-amber-900" },
  };
  const entry = map[outcome] ?? { label: outcome, cls: "bg-brand-ink/10" };
  return (
    <span
      className={`text-xs uppercase tracking-wider px-2 py-0.5 rounded ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "error" | "muted";
}) {
  const valueCls =
    tone === "success"
      ? "text-emerald-700"
      : tone === "error"
      ? "text-red-700"
      : tone === "muted"
      ? "text-brand-ink/50"
      : "text-brand-ink";
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-brand-ink/50">
        {label}
      </p>
      <p className={`font-marker text-2xl ${valueCls}`}>{value}</p>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatEta(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return `${hours}h ${rem}m`;
}
