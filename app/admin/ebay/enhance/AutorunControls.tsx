"use client";

// Autorun price bump card — start form when idle, live status + stop
// button while running. Server component (page.tsx) passes the current
// status; this component only fires the start/stop API calls.

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AutorunCardStatus = {
  amount: string;
  floor: string;
  minDaysBetween: number;
  maxCycles: number | null;
  cycleCount: number;
  totalWiggled: number;
  doneThisCycle: number;
  totalItems: number;
  outstanding: number;
  startedAt: string; // ISO
};

export default function AutorunCard({
  status,
}: {
  status: AutorunCardStatus | null;
}) {
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5 mb-10">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-1">
        <p className="text-xs uppercase tracking-wider text-brand-ink/50">
          Autorun price bump
        </p>
        {status && (
          <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-brand-yellow text-brand-ink">
            running
          </span>
        )}
      </div>
      <p className="text-sm text-brand-ink/60 mb-4 max-w-2xl">
        Slowly cycles the whole inventory, nudging each price by a random
        amount within ± the value you set — centered on each item&rsquo;s
        anchor price, so prices never drift. Runs at low priority: your
        normal batches always go first.
      </p>
      {status ? <RunningStatus status={status} /> : <StartForm />}
    </div>
  );
}

function StartForm() {
  const router = useRouter();
  const [amount, setAmount] = useState("0.05");
  const [floor, setFloor] = useState("0.99");
  const [minDays, setMinDays] = useState("4");
  const [maxCycles, setMaxCycles] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0.01) {
      setError("Amount must be at least 0.01");
      return;
    }
    if (
      !confirm(
        `Start the autorun? Every active listing will be nudged by up to ±$${amt.toFixed(
          2
        )} (no more than once every ${minDays || "4"} days per item) until you stop it${
          maxCycles ? ` or ${maxCycles} full cycle(s) complete` : ""
        }.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/enhance/autorun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          floor,
          minDaysBetween: minDays,
          maxCycles: maxCycles || null,
        }),
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
    <div>
      <div className="flex items-end gap-4 flex-wrap">
        <Field label="± Amount ($)">
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="border border-brand-ink/25 rounded px-2 py-1.5 text-sm w-24"
          />
        </Field>
        <Field label="Floor ($)">
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="border border-brand-ink/25 rounded px-2 py-1.5 text-sm w-24"
          />
        </Field>
        <Field label="Min days between touches">
          <input
            type="number"
            step="1"
            min="1"
            value={minDays}
            onChange={(e) => setMinDays(e.target.value)}
            className="border border-brand-ink/25 rounded px-2 py-1.5 text-sm w-24"
          />
        </Field>
        <Field label="Max cycles (blank = until stopped)">
          <input
            type="number"
            step="1"
            min="1"
            value={maxCycles}
            onChange={(e) => setMaxCycles(e.target.value)}
            placeholder="∞"
            className="border border-brand-ink/25 rounded px-2 py-1.5 text-sm w-24"
          />
        </Field>
        <button
          onClick={start}
          disabled={busy}
          className="bg-brand-ink text-brand-paper rounded px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Starting…" : "Start autorun"}
        </button>
      </div>
      <p className="text-xs text-brand-ink/40 mt-3">
        Heads-up: each touch costs 2 eBay API calls. 8,000 listings on a
        3-day cycle ≈ 5,300 calls/day — close to the default 5,000/day
        Trading API allowance. 4+ days keeps comfortable headroom.
      </p>
      {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
    </div>
  );
}

function RunningStatus({ status }: { status: AutorunCardStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    if (
      !confirm(
        "Stop the autorun? Queued wiggles are cancelled; prices stay where they are (each within ± the set amount of its anchor)."
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/enhance/autorun/stop", {
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

  const pct =
    status.totalItems > 0
      ? Math.round((status.doneThisCycle / status.totalItems) * 100)
      : 0;

  return (
    <div className="flex items-center justify-between gap-6 flex-wrap">
      <div className="flex gap-8 flex-wrap text-sm">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/40 mb-0.5">
            Cycle
          </p>
          <p className="font-medium">
            {status.cycleCount + 1}
            {status.maxCycles ? ` of ${status.maxCycles}` : " (until stopped)"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/40 mb-0.5">
            This cycle
          </p>
          <p className="font-medium">
            {status.doneThisCycle.toLocaleString()} /{" "}
            {status.totalItems.toLocaleString()} ({pct}%)
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/40 mb-0.5">
            Total wiggled
          </p>
          <p className="font-medium">{status.totalWiggled.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/40 mb-0.5">
            Settings
          </p>
          <p className="font-medium">
            ±${Number(status.amount).toFixed(2)} · floor $
            {Number(status.floor).toFixed(2)} · every {status.minDaysBetween}d
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/40 mb-0.5">
            In queue
          </p>
          <p className="font-medium">{status.outstanding}</p>
        </div>
      </div>
      <div className="text-right">
        <button
          onClick={stop}
          disabled={busy}
          className="bg-white border border-red-300 text-red-700 hover:border-red-500 rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {busy ? "Stopping…" : "Stop autorun"}
        </button>
        {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-brand-ink/40 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
