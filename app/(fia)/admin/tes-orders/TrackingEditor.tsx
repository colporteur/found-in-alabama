"use client";

// Per-order shipping status + manual tracking set/clear (Phase SHIP-1).

import { useState } from "react";
import { useRouter } from "next/navigation";

// Keep in sync with NOT_SHIPPING in lib/tes/pirate-ship.ts (client file,
// so no server-module import).
const NOT_SHIPPING = "not shipping";

export default function TrackingEditor({
  orderId,
  tracking,
  trackingHref,
  carrier,
  shippedAt,
  exportedAt,
}: {
  orderId: string;
  tracking: string | null;
  trackingHref: string | null;
  carrier: string | null;
  shippedAt: string | null;
  exportedAt: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tracking ?? "");
  const [saving, setSaving] = useState(false);

  async function save(next: string | null, skip = false) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tes-orders/${orderId}/tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skip ? { skip: true } : { tracking: next }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setEditing(false);
      router.refresh();
    } catch (err) {
      alert(`Failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Tracking number"
          className="border border-brand-ink/20 rounded px-2 py-1 w-64"
          autoFocus
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => save(value.trim() || null)}
          className="px-3 py-1 rounded bg-brand-ink text-white disabled:opacity-50"
        >
          Save
        </button>
        {tracking && (
          <button
            type="button"
            disabled={saving}
            onClick={() => save(null)}
            className="px-3 py-1 rounded border border-red-300 text-red-700 disabled:opacity-50"
          >
            Clear
          </button>
        )}
        <button type="button" onClick={() => setEditing(false)} className="text-brand-ink/60">
          Cancel
        </button>
      </span>
    );
  }

  if (!tracking && carrier === NOT_SHIPPING && shippedAt) {
    return (
      <span className="text-sm flex flex-wrap items-center gap-2">
        <span className="inline-block text-xs px-2 py-0.5 rounded bg-brand-ink/10 text-brand-ink/70">
          Not shipping
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={() => save(null)}
          className="text-brand-ink/50 hover:text-brand-ink disabled:opacity-50"
        >
          undo
        </button>
      </span>
    );
  }

  return (
    <span className="text-sm flex flex-wrap items-center gap-2">
      {tracking ? (
        <>
          <span className="inline-block text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">
            Shipped{shippedAt ? ` ${new Date(shippedAt).toLocaleDateString()}` : ""}
          </span>
          {trackingHref ? (
            <a href={trackingHref} target="_blank" rel="noopener noreferrer" className="text-brand-earth hover:underline">
              {carrier ? `${carrier} ` : ""}
              {tracking} ↗
            </a>
          ) : (
            <span>{tracking}</span>
          )}
        </>
      ) : exportedAt ? (
        <span className="inline-block text-xs px-2 py-0.5 rounded bg-sky-100 text-sky-800">
          Sent to Pirate Ship {new Date(exportedAt).toLocaleDateString()}
        </span>
      ) : (
        <span className="inline-block text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">
          Not shipped
        </span>
      )}
      <button type="button" onClick={() => setEditing(true)} className="text-brand-ink/50 hover:text-brand-ink">
        {tracking ? "edit" : "add tracking"}
      </button>
      {!tracking && (
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            if (confirm("Don't ship this order? It will be left out of Pirate Ship downloads (use for test orders).")) {
              void save(null, true);
            }
          }}
          className="text-brand-ink/50 hover:text-brand-ink disabled:opacity-50"
        >
          don&apos;t ship
        </button>
      )}
    </span>
  );
}
