"use client";

// Phase 3e: Check with eBay (dry run, creates nothing) → Publish to eBay.
// Also: which road this draft takes (eBay directly or Nifty), and for single
// trading cards the card condition eBay requires (Graded/Ungraded).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GRADERS, GRADES, UNGRADED, type CardCondition } from "@/lib/ebay/publish-core";

type Msg = { severity: "Error" | "Warning"; code: string | null; message: string };
type Check = {
  at: string;
  ok: boolean;
  messages: Msg[];
  fees: { total: number; lines: Array<{ name: string; amount: number; listed?: number }> } | null;
  summary: {
    price: number;
    categoryId: string;
    conditionId: string;
    cardCondition?: string | null;
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
  "2750": "Graded",
  "3000": "Used",
  "4000": "Very Good / Ungraded",
  "5000": "Good",
  "6000": "Acceptable",
  "7000": "For parts",
};

export function EbayPublishPanel({
  id,
  initial,
  status,
  route,
  canChooseRoute,
  card,
  cardChosen,
}: {
  id: string;
  initial: Check | null;
  status: string;
  route: "ebay" | "nifty";
  canChooseRoute: boolean;
  card: CardCondition | null;
  cardChosen: boolean;
}) {
  const router = useRouter();
  const [cc, setCc] = useState<CardCondition | null>(card);
  const [ccBusy, setCcBusy] = useState(false);
  const [ccSaved, setCcSaved] = useState(false);

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/listings/${id}/ebay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
    return out;
  }
  async function chooseRoute(next: "ebay" | "nifty") {
    setErr(null);
    try {
      await post({ action: "route", route: next });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function saveCard() {
    if (!cc) return;
    setCcBusy(true);
    setErr(null);
    try {
      await post({ action: "card", card: cc });
      setCcSaved(true);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCcBusy(false);
    }
  }
  const canPublish = (status === "approved" && route === "ebay") || status === "in_nifty" || (status === "approved" && canChooseRoute && !card);
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
      <h2 className="text-xs uppercase tracking-wider text-brand-earth">{card ? "Single card → eBay" : "Publish to eBay (pilot)"}</h2>
      {canChooseRoute && (status === "review" || status === "approved") && !done && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-brand-ink/60">When approved, this goes:</span>
          <label className="flex items-center gap-1">
            <input type="radio" name={`road-${id}`} checked={route === "ebay"} onChange={() => chooseRoute("ebay")} /> straight to eBay from FIA
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name={`road-${id}`} checked={route === "nifty"} onChange={() => chooseRoute("nifty")} /> to Nifty
          </label>
        </div>
      )}
      {card && cc && !done && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-brand-ink/60">Card condition{!cardChosen && !ccSaved ? " (FIA's guess)" : ""}:</span>
          <select
            value={cc.graded ? "graded" : "ungraded"}
            onChange={(e) => {
              setCcSaved(false);
              setCc(e.target.value === "graded" ? { graded: true, grader: "PSA", grade: "9", cert: null } : { graded: false, condition: "Excellent" });
            }}
            className="border rounded px-1 py-0.5"
          >
            <option value="ungraded">Ungraded</option>
            <option value="graded">Graded</option>
          </select>
          {!cc.graded ? (
            <select
              value={cc.condition}
              onChange={(e) => {
                setCcSaved(false);
                setCc({ graded: false, condition: e.target.value as (typeof UNGRADED)[number] });
              }}
              className="border rounded px-1 py-0.5"
            >
              {UNGRADED.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          ) : (
            <>
              <select
                value={cc.grader}
                onChange={(e) => {
                  setCcSaved(false);
                  setCc({ ...cc, grader: e.target.value });
                }}
                className="border rounded px-1 py-0.5"
              >
                {Object.keys(GRADERS).map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              <select
                value={cc.grade}
                onChange={(e) => {
                  setCcSaved(false);
                  setCc({ ...cc, grade: e.target.value });
                }}
                className="border rounded px-1 py-0.5"
              >
                {Object.keys(GRADES).map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              <input
                value={cc.cert ?? ""}
                placeholder="cert # (optional)"
                onChange={(e) => {
                  setCcSaved(false);
                  setCc({ ...cc, cert: e.target.value });
                }}
                className="border rounded px-1 py-0.5 w-36"
              />
            </>
          )}
          <button type="button" onClick={saveCard} disabled={ccBusy} className="px-2 py-0.5 rounded border border-brand-ink/30 disabled:opacity-50">
            {ccBusy ? "Saving…" : ccSaved ? "Saved" : "Save"}
          </button>
        </div>
      )}
      {status === "in_nifty" && !done && (
        <p className="text-amber-900">
          This card was already sent to Nifty, which can&apos;t list single cards on eBay. Publish it to eBay here; FIA leaves the
          Nifty item alone. Afterwards don&apos;t publish or import it to eBay in Nifty, or eBay will have it twice.
        </p>
      )}
      {status === "review" && card && route === "ebay" && (
        <p className="text-brand-ink/60">Once approved it waits on the Listings page for Publish to eBay (or publish it here).</p>
      )}
      {!canPublish ? null : done ? (
        <p>
          Listed on eBay:{" "}
          <a className="underline" href={`https://www.ebay.com/itm/${done}`} target="_blank" rel="noreferrer">
            {done}
          </a>
          . Check it on eBay.
        </p>
      ) : (
        <>
          <p className="text-brand-ink/70">
            List it on eBay directly from FIA. <strong>Check with eBay</strong> asks eBay to validate the listing without
            creating it.
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
      {check && !done && canPublish && (
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
                {s.categoryId} · {s.cardCondition ?? CONDITION[s.conditionId] ?? s.conditionId}
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
                  <dd>
                    {check.fees.total > 0 ? `$${check.fees.total.toFixed(2)}` : "none"}
                    {check.fees.lines.length > 0 &&
                      ` (${check.fees.lines
                        .map((l) => (l.listed != null ? `${l.name} $${l.listed.toFixed(2)} less eBay discount = $${l.amount.toFixed(2)}` : `${l.name} $${l.amount.toFixed(2)}`))
                        .join("; ")})`}
                  </dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
