"use client";

// Toggle an order's delist status (pending ⇄ done). "Done" means every
// item on the order has been delisted from Nifty.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MarkHandledButton({
  orderId,
  handled,
}: {
  orderId: string;
  handled: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tes-orders/${orderId}/handled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handled: !handled }),
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
      className={`text-sm px-4 py-2 rounded font-medium disabled:opacity-50 ${
        handled
          ? "bg-green-100 text-green-800 hover:bg-green-200"
          : "bg-red-700 text-white hover:bg-red-800"
      }`}
    >
      {saving
        ? "Saving…"
        : handled
        ? "✓ Delisted (click to undo)"
        : "Mark delisted in Nifty"}
    </button>
  );
}
