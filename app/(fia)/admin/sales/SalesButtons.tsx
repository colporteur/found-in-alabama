"use client";

// Client controls for /admin/sales: run the pipeline now, and settle a sale
// from the review queue (pick a candidate, type an id, or ignore it).

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunSalesSyncButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cron/sales-sync", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        ready?: boolean;
        ms?: number;
        errors?: string[];
      };
      if (!res.ok || !body.ok) throw new Error(body.errors?.join("; ") || `HTTP ${res.status}`);
      setMessage(
        body.ready === false
          ? "Tables not created yet — run the migration."
          : `Done in ${((body.ms ?? 0) / 1000).toFixed(1)}s.`
      );
      router.refresh();
    } catch (err) {
      setMessage(`Failed: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="text-sm px-4 py-2 rounded font-medium bg-brand-ink text-white hover:bg-brand-ink/80 disabled:opacity-50"
      >
        {running ? "Running…" : "Run now"}
      </button>
      {message && <span className="text-sm text-brand-ink/70">{message}</span>}
    </div>
  );
}

async function post(body: Record<string, string>) {
  const res = await fetch("/api/admin/sales/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
}

export function MatchControls({
  id,
  candidates,
}: {
  id: string;
  candidates: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      await post({ id, ...body });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {candidates.map((c) => (
        <button
          key={c.id}
          type="button"
          disabled={busy}
          onClick={() => act({ action: "match", ref: c.id })}
          className="text-left text-xs px-2 py-1 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-50"
        >
          This one: {c.label}
        </button>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ref.trim()) act({ action: "match", ref: ref.trim() });
        }}
      >
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="eBay item id, eBay URL or registry id"
          className="text-xs px-2 py-1 border border-brand-ink/20 rounded w-64"
        />
        <button
          type="submit"
          disabled={busy || !ref.trim()}
          className="text-xs px-2 py-1 rounded bg-brand-ink text-white disabled:opacity-50"
        >
          Match
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act({ action: "ignore" })}
          className="text-xs px-2 py-1 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-50"
        >
          Ignore
        </button>
      </form>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
