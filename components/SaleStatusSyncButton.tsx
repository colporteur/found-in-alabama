"use client";

// "Sync status from eBay" button on /admin/ebay/sales. Reconciles local
// sale rows with eBay's real promotion statuses (catches sales activated,
// paused, or ended in Seller Hub).

import { useState } from "react";

export default function SaleStatusSyncButton() {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "error"; msg: string } | null>(
    null
  );

  async function sync() {
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/ebay/sales/sync-status", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFlash({
        kind: "ok",
        msg: `Updated ${data.updated} sale${data.updated === 1 ? "" : "s"} from eBay (${data.promotionsFetched} promotions checked).`,
      });
      if (data.updated > 0) setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setFlash({
        kind: "error",
        msg: err instanceof Error ? err.message : "Sync failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        onClick={sync}
        disabled={busy}
        className="text-sm px-3 py-1.5 border border-brand-ink/20 rounded hover:bg-brand-ink/5 transition-colors disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync status from eBay"}
      </button>
      {flash && (
        <span
          className={`text-xs ${flash.kind === "error" ? "text-red-700" : "text-emerald-700"}`}
        >
          {flash.msg}
        </span>
      )}
    </div>
  );
}
