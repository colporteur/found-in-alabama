"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancelBatchButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!confirm("Cancel this batch? Pending jobs will be skipped.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/enhance/batches/${batchId}/cancel`, {
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
    <div className="text-right">
      <button
        onClick={cancel}
        disabled={busy}
        className="bg-white border border-red-300 text-red-700 hover:border-red-500 rounded px-4 py-2 text-sm disabled:opacity-50"
      >
        {busy ? "Cancelling…" : "Cancel batch"}
      </button>
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  );
}
