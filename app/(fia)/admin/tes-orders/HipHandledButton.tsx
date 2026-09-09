"use client";

// Acknowledge a Hip sale decision on the Delist board (Phase HIP-1):
// "cancel_hip" → Todd canceled/refunded the order on HipPostcard;
// manual lines → dealt with by hand. Toggles hip_sales.handled_at.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HipHandledButton({
  hipSaleId,
  handled,
  label,
}: {
  hipSaleId: number;
  handled: boolean;
  label: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/hip-sales/${hipSaleId}/handled`, {
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
      {saving ? "Saving…" : handled ? "✓ Handled (click to undo)" : label}
    </button>
  );
}
