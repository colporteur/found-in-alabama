"use client";

// Client-side rollback controls, shared by the batch detail page and the
// history browser. Batch/session rollbacks loop time-budgeted API slices
// until the server reports nothing remaining.

import { useState } from "react";
import { useRouter } from "next/navigation";

type SliceSummary = {
  processed: number;
  rolledBack: number;
  failed: number;
  ineligible: number;
  remaining: number;
  errors: string[];
};

export function JobRollbackButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!confirm("Restore this item's previous value on eBay?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/enhance/jobs/${jobId}/rollback`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        onClick={run}
        disabled={busy}
        className="text-xs border border-brand-ink/25 hover:border-brand-ink rounded px-2 py-0.5 disabled:opacity-50 whitespace-nowrap"
      >
        {busy ? "Rolling back…" : "Roll back"}
      </button>
      {error && <span className="block text-xs text-red-700 mt-1">{error}</span>}
    </span>
  );
}

function useSliceLoop(url: string, body?: Record<string, unknown>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(confirmText: string) {
    if (!confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    let total = 0;
    let failed = 0;
    try {
      // Loop slices until nothing remains (cap prevents a runaway loop).
      for (let i = 0; i < 100; i++) {
        const res = await fetch(url, {
          method: "POST",
          ...(body
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        });
        const data = (await res.json()) as SliceSummary & { error?: string };
        if (!res.ok) {
          setError(data.error ?? `Failed (${res.status})`);
          return;
        }
        total += data.rolledBack;
        failed += data.failed;
        setProgress(
          `${total} rolled back${failed ? `, ${failed} failed` : ""}${
            data.remaining ? `, ${data.remaining} to go…` : ""
          }`
        );
        if (data.remaining === 0) break;
        // Failures stay "remaining"-eligible only if retryable; the server
        // skips them within a slice — if a slice made no progress, stop.
        if (data.rolledBack === 0 && data.remaining > 0) {
          setError(
            `${data.remaining} job(s) could not be rolled back — see per-job errors on the batch page.`
          );
          break;
        }
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return { busy, progress, error, run };
}

export function BatchRollbackButton({ batchId }: { batchId: string }) {
  const { busy, progress, error, run } = useSliceLoop(
    `/api/admin/enhance/batches/${batchId}/rollback`
  );
  return (
    <div className="text-right">
      <button
        onClick={() =>
          run("Roll back ALL completed jobs in this batch to their previous values?")
        }
        disabled={busy}
        className="bg-white border border-red-300 text-red-700 hover:border-red-500 rounded px-4 py-2 text-sm disabled:opacity-50"
      >
        {busy ? "Rolling back…" : "Roll back batch"}
      </button>
      {progress && <p className="text-xs text-brand-ink/60 mt-1">{progress}</p>}
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  );
}

export function SessionRollbackButton() {
  const { busy, progress, error, run } = useSliceLoop(
    "/api/admin/enhance/rollback-session",
    { hours: 24 }
  );
  return (
    <div className="text-right">
      <button
        onClick={() =>
          run(
            "Roll back EVERYTHING the enhance pipeline changed in the last 24 hours?"
          )
        }
        disabled={busy}
        className="bg-white border border-red-300 text-red-700 hover:border-red-500 rounded px-4 py-2 text-sm disabled:opacity-50"
      >
        {busy ? "Rolling back…" : "Roll back last 24h"}
      </button>
      {progress && <p className="text-xs text-brand-ink/60 mt-1">{progress}</p>}
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  );
}
