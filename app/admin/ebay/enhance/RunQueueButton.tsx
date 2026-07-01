"use client";

// Loops the enhance-queue tick endpoint until a tick reports no work
// done, so Todd doesn't have to wait for GitHub's (often delayed) 5-min
// cron. Each tick processes up to ~45s of jobs server-side.

import { useState } from "react";
import { useRouter } from "next/navigation";

type TickSummary = {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
  waiting?: number;
  errors?: string[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function RunQueueButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    let total = 0;
    let waitCycles = 0;
    try {
      for (let i = 0; i < 100; i++) {
        const res = await fetch("/api/cron/enhance");
        const data = (await res.json()) as TickSummary & { error?: string };
        if (!res.ok) {
          setError(data.error ?? `Failed (${res.status})`);
          return;
        }
        total += data.processed;
        const waiting = data.waiting ?? 0;

        if (data.processed > 0) {
          setProgress(`${total} job${total === 1 ? "" : "s"} processed…`);
          router.refresh();
          continue; // more work — tick again immediately
        }
        if (waiting > 0 && waitCycles < 20) {
          // APR jobs in flight — re-poll every 30s (up to ~10 min) so a
          // price-research batch finishes without relying on the cron.
          waitCycles++;
          setProgress(
            `${waiting} job${waiting === 1 ? "" : "s"} waiting on APR — checking again in 30s (${waitCycles}/20)…`
          );
          await sleep(30_000);
          continue;
        }
        setProgress(
          total > 0
            ? `Done — ${total} job${total === 1 ? "" : "s"} processed.`
            : waiting > 0
            ? `${waiting} job(s) still waiting on APR — the cron will finish them, or click again later.`
            : "Queue is idle."
        );
        break;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2 disabled:opacity-50"
      >
        {busy ? "Running queue…" : "Run queue now →"}
      </button>
      {progress && !error && (
        <span className="text-xs text-brand-ink/50">{progress}</span>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
