"use client";

// Phase 3e pilot: Check with eBay (dry run, creates nothing) → Publish to eBay.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Msg = { severity: "Error" | "Warning"; code: string | null; message: string };
type Check = {
  at: string;
  ok: boolean;
  messages: Msg[];
  fees: { total: number; lines: Array<{ name: string; amount: number }> } | null;
  summary: {
    price: number;
    categoryId: string;
    conditionId: string;
    storeCategoryIds: string[];
    photos: number;
    weightOz: number | null;
    shippingPolicy: string | null;
    copiedFrom: string;
    returnPolicyId: string | null;
    paymentPolicyId: string | null;
    location: string | null;
    handlingDays: string | null;
    bestOffer: boolean;
  };
};

const CONDITION: Record<string, string> = {
  "1000": "New",
  "1500": "New other",
  "2750": "Like New",
  "3000": "Used",
  "4000": "Very Good",
  "5000": "Good",
  "6000": "Acceptable",
  "7000": "For parts",
};

export function EbayPublishPanel({ id, initial }: { id: string; initial: Check | null }) {
  const router = useRouter();
  const [check, setCheck] = useState<Check | null>(initial);
  const [busy, setBusy] = useState<"check" | "publish" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sure, setSure] = useState(false);

  async function call(action: "check" | "publish") {
    setBusy(action);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/listings/${id}/ebay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      if (action === "check") {
        setCheck(out.check);
        setSure(false);
      } else {
        setDone(out.itemId);
        router.refresh();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const s = check?.summary;
  const errors = check?.messages.filter((m) => m.severity === "Error") ?? [];
  const warnings = check?.messages.filter((m) => m.severity === "Warning") ?? [];
  return (
    <div className="bg-white border border-amber-300 rounded-lg p-4 mb-8 text-sm space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-brand-earth">Publish to eBay (pilot)</h2>
      {done ? (
        <p>
          Listed on eBay:{" "}
          <a className="underline" href={`https://www.ebay.com/itm/${done}`} target="_blank" rel="noreferrer">
            {done}
          </a>
          . Check it on eBay, then import it into Nifty to crosslist.
        </p>
      ) : (
        <>
          <p className="text-brand-ink/70">
            Instead of sending this draft to Nifty, list it on eBay directly. <strong>Check with eBay</strong> asks eBay to
            validate the listing without creating it.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" onClick={() => call("check")} disabled={!!busy} className="px-3 py-1.5 rounded border border-brand-ink/30 disabled:opacity-50">
              {busy === "check" ? "Asking eBay…" : check ? "Check again" : "Check with eBay"}
            </button>
            {check?.ok && (
              <>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I&apos;ve read the check
                </label>
                <button
                  type="button"
                  onClick={() => call("publish")}
                  disabled={!!busy || !sure}
                  className="px-3 py-1.5 rounded bg-brand-ink text-white disabled:opacity-50"
                >
                  {busy === "publish" ? "Publishing…" : "Publish to eBay"}
                </button>
              </>
            )}
          </div>
        </>
      )}
      {err && <p className="text-red-800">{err}</p>}
      {check && !done && (
        <div className="space-y-2">
          <p className={check.ok ? "text-green-800" : "text-red-800"}>
            {check.ok ? "eBay accepts this listing." : "eBay would reject this listing:"} <span className="text-brand-ink/50">({new Date(check.at).toLocaleString("en-US")})</span>
          </p>
          {errors.length > 0 && (
            <ul className="list-disc pl-5 text-red-800">
              {errors.map((m, k) => (
                <li key={k}>{m.message}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="list-disc pl-5 text-amber-800">
              {warnings.map((m, k) => (
                <li key={k}>{m.message}</li>
              ))}
            </ul>
          )}
          {s && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-brand-ink/50">Price</dt>
              <dd>${s.price.toFixed(2)}{s.bestOffer ? " · Best Offer on" : ""}</dd>
              <dt className="text-brand-ink/50">Category · condition</dt>
              <dd>
                {s.categoryId} · {CONDITION[s.conditionId] ?? s.conditionId}
              </dd>
              <dt className="text-brand-ink/50">Store shelves</dt>
              <dd>{s.storeCategoryIds.join(", ") || "none"}</dd>
              <dt className="text-brand-ink/50">Photos · weight</dt>
              <dd>
                {s.photos} · {s.weightOz ? `${s.weightOz} oz` : "reference listing's"}
              </dd>
              <dt className="text-brand-ink/50">Shipping policy</dt>
              <dd>{s.shippingPolicy ?? "?"}</dd>
              <dt className="text-brand-ink/50">Copied from</dt>
              <dd>
                <a className="underline" href={`https://www.ebay.com/itm/${s.copiedFrom}`} target="_blank" rel="noreferrer">
                  {s.copiedFrom}
                </a>{" "}
                (returns {s.returnPolicyId ?? "?"}, payment {s.paymentPolicyId ?? "?"}, {s.location ?? "?"}, {s.handlingDays ?? "?"}-day handling)
              </dd>
              {check.fees && (
                <>
                  <dt className="text-brand-ink/50">eBay listing fees</dt>
                  <dd>{check.fees.total > 0 ? `$${check.fees.total.toFixed(2)} (${check.fees.lines.map((l) => l.name).join(", ")})` : "none"}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
