"use client";

import { useState, type ReactNode } from "react";

/** One of the straight-to-eBay switches (enabled | cardsDirect). */
export function EbayPublishSwitch({ initial, field = "enabled", children }: { initial: boolean; field?: "enabled" | "cardsDirect"; children?: ReactNode }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function flip(next: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/listings/ebay-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOn(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => flip(e.target.checked)} />
      <span>
        {children ?? (
          <>
            Show <strong>Publish to eBay (pilot)</strong> on approved drafts
          </>
        )}
      </span>
      {err && <span className="text-red-800">{err}</span>}
    </label>
  );
}
