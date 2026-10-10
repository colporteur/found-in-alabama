"use client";

// "In Nifty" drafts become "Published" by themselves once their eBay listing
// shows up in FIA's eBay mirror (checked every few minutes, by title). If
// the title was changed in Nifty, paste the eBay item number or link here.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkListed({ id }: { id: string }) {
  const router = useRouter();
  const [ebay, setEbay] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/listings/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_listed", ebay: ebay.trim() || undefined }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-2 mt-2 border-t border-brand-ink/10">
      <p className="text-xs text-brand-ink/60 mb-2">
        Published it in Nifty? FIA marks it published by itself once the eBay listing appears (within ~15 minutes, matched by
        title). If you changed the title in Nifty, paste the eBay item number or link:
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={ebay}
          onChange={(e) => setEbay(e.target.value)}
          placeholder="eBay item number or link (optional)"
          className="border border-brand-ink/20 rounded px-2 py-1 text-sm w-72"
        />
        <button type="button" onClick={go} disabled={busy} className="text-sm px-3 py-1.5 rounded bg-brand-ink text-white disabled:opacity-50">
          {busy ? "Checking…" : "Mark as listed"}
        </button>
        {msg && <span className="text-sm text-red-800">{msg}</span>}
      </div>
    </div>
  );
}
