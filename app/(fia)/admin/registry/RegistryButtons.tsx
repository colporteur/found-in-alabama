"use client";

// Client controls for /admin/registry: run the sync now, and dismiss /
// reopen a review row.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunSyncButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cron/registry-sync", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        ms?: number;
        error?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessage(`Sync finished in ${((body.ms ?? 0) / 1000).toFixed(1)}s.`);
      router.refresh();
    } catch (err) {
      setMessage(`Sync failed: ${(err as Error).message}`);
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
        {running ? "Syncing…" : "Run sync now"}
      </button>
      {message && <span className="text-sm text-brand-ink/70">{message}</span>}
    </div>
  );
}

export function ReviewToggle({ id, dismissed }: { id: string; dismissed: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/registry/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: dismissed ? "reopen" : "dismiss" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      alert(`Failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      className="text-xs px-2 py-1 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-50"
    >
      {saving ? "…" : dismissed ? "Reopen" : "Dismiss"}
    </button>
  );
}
