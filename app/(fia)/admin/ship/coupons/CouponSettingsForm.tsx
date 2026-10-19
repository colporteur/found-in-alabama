"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CouponSettings } from "@/lib/shop/coupons";

const VENUE_LABEL: Record<string, string> = {
  ebay: "eBay",
  mercari: "Mercari",
  poshmark: "Poshmark",
  depop: "Depop",
  whatnot: "Whatnot",
  hip: "HipPostcard",
  tes: "The Ephemeral State",
  fia: "Found in Alabama",
};

export function CouponSettingsForm({ initial }: { initial: CouponSettings }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Save failed");
      setS(j.settings);
      setNote("Saved.");
      router.refresh();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-brand-ink/15 p-4 max-w-3xl text-sm space-y-4">
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        Print a coupon code on invoices
      </label>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2">
          Percent off
          <input
            type="number"
            min={1}
            max={90}
            step={1}
            value={s.percent}
            onChange={(e) => setS({ ...s, percent: Number(e.target.value) })}
            className="w-20 rounded border border-brand-ink/25 px-2 py-1"
          />
          %
        </label>
        <label className="flex items-center gap-2">
          Expires after
          <input
            type="number"
            min={1}
            max={365}
            value={s.days}
            onChange={(e) => setS({ ...s, days: Number(e.target.value) })}
            className="w-20 rounded border border-brand-ink/25 px-2 py-1"
          />
          days
        </label>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.stockLine} onChange={(e) => setS({ ...s, stockLine: e.target.checked })} />
          Add a stock line (&ldquo;theephemeralstate.com has over 4,300 postcards in stock today&rdquo;)
        </label>
        <label className="flex items-center gap-2 pl-6">
          Use a category&apos;s count only when it has at least
          <input
            type="number"
            min={1}
            value={s.stockMin}
            onChange={(e) => setS({ ...s, stockMin: Number(e.target.value) })}
            className="w-20 rounded border border-brand-ink/25 px-2 py-1"
          />
          items; otherwise its parent&apos;s, then the whole store&apos;s.
        </label>
        <p className="pl-6 text-xs text-brand-ink/50">
          Per category: the wording and whether to count from the parent are on{" "}
          <a href="/admin/ebay/categories" className="underline">Store categories</a>.
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.qr} onChange={(e) => setS({ ...s, qr: e.target.checked })} />
          Add a QR code to that shelf on the site, with the code filled in at checkout
        </label>
      </div>
      <div>
        <p className="mb-1 text-brand-ink/70">Invoices for sales on:</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {Object.keys(VENUE_LABEL).map((v) => (
            <label key={v} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={s.venues[v] !== false}
                onChange={(e) => setS({ ...s, venues: { ...s.venues, [v]: e.target.checked } })}
              />
              {VENUE_LABEL[v]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-brand-ink/50">
          eBay&apos;s rules don&apos;t allow offering off-eBay purchases in an eBay order; switch eBay off here if
          you&apos;d rather not take that chance.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-4 py-1.5 rounded bg-brand-ink text-white font-semibold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {note && <span>{note}</span>}
      </div>
    </div>
  );
}
