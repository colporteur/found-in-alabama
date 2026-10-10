"use client";

// Small client controls for the books pages: postage per package, the haul
// form, fee rates, and the haul/cost panel on a listing draft.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FeeRule } from "@/lib/books/fees";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

export function PostageInput({ orderId, value }: { orderId: string; value: number | null }) {
  const router = useRouter();
  const [v, setV] = useState(value == null ? "" : value.toFixed(2));
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  return (
    <input
      value={v}
      inputMode="decimal"
      placeholder="$"
      title="What the label cost you"
      onChange={(e) => setV(e.target.value)}
      onBlur={async () => {
        const next = v.trim() === "" ? null : v.replace(/[^0-9.]/g, "");
        if ((next == null && value == null) || (next != null && value != null && Number(next) === value)) return;
        setState("saving");
        try {
          await post({ action: "postage", orderId, cost: next });
          setState("idle");
          router.refresh();
        } catch {
          setState("error");
        }
      }}
      className={`w-20 border rounded px-2 py-1 text-right ${state === "error" ? "border-red-500" : ""} ${
        value == null ? "bg-amber-50" : ""
      }`}
    />
  );
}

const KIND_LABEL: Record<string, string> = {
  estate_sale: "Estate sale",
  auction: "Auction",
  thrift: "Thrift",
  yard_sale: "Yard sale",
  online: "Online",
  other: "Other",
};

export type HaulFormValue = {
  id?: string;
  name: string;
  acquiredOn: string;
  kind: string;
  totalCost: string;
  notes: string;
};

export function HaulForm({ initial, onDone }: { initial?: HaulFormValue; onDone?: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<HaulFormValue>(
    initial ?? { name: "", acquiredOn: new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }), kind: "estate_sale", totalCost: "", notes: "" }
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof HaulFormValue) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const input = "border rounded px-3 py-2 text-sm";
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await post({ action: "haul", ...f, totalCost: f.totalCost.replace(/[^0-9.]/g, "") || null });
          if (!initial) setF({ ...f, name: "", totalCost: "", notes: "" });
          onDone?.();
          router.refresh();
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-sm">
        <span className="block text-brand-ink/60 mb-1">Name</span>
        <input className={`${input} w-64`} value={f.name} onChange={set("name")} placeholder="Smith estate sale, Anniston" />
      </label>
      <label className="text-sm">
        <span className="block text-brand-ink/60 mb-1">Date</span>
        <input type="date" className={input} value={f.acquiredOn} onChange={set("acquiredOn")} />
      </label>
      <label className="text-sm">
        <span className="block text-brand-ink/60 mb-1">Kind</span>
        <select className={input} value={f.kind} onChange={set("kind")}>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="block text-brand-ink/60 mb-1">Total paid</span>
        <input className={`${input} w-28`} inputMode="decimal" value={f.totalCost} onChange={set("totalCost")} placeholder="$" />
      </label>
      <label className="text-sm">
        <span className="block text-brand-ink/60 mb-1">Notes</span>
        <input className={`${input} w-64`} value={f.notes} onChange={set("notes")} placeholder="incl. buyer's premium, gas…" />
      </label>
      <button disabled={busy} className="px-4 py-2 rounded bg-brand-ink text-white text-sm disabled:opacity-50">
        {busy ? "Saving…" : initial ? "Save" : "Add haul"}
      </button>
      {err && <span className="text-sm text-red-700">{err}</span>}
    </form>
  );
}

export function EditHaul({ value }: { value: HaulFormValue }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="mt-2">
      <HaulForm initial={value} onDone={() => setOpen(false)} />
    </div>
  ) : (
    <button type="button" className="text-xs underline text-brand-ink/60" onClick={() => setOpen(true)}>
      edit
    </button>
  );
}

const VENUES = ["ebay", "mercari", "poshmark", "depop", "whatnot", "hip", "tes", "fia"];
const VENUE_LABEL: Record<string, string> = { ebay: "eBay", mercari: "Mercari", poshmark: "Poshmark", depop: "Depop", whatnot: "Whatnot", hip: "HipPostcard", tes: "The Ephemeral State (Stripe)", fia: "Found in Alabama (Stripe)" };

export function FeeForm({ fees, buyerPaid }: { fees: Record<string, FeeRule>; buyerPaid: string[] }) {
  const router = useRouter();
  const [f, setF] = useState(() =>
    Object.fromEntries(
      VENUES.map((v) => [
        v,
        {
          pct: String(fees[v]?.pct ?? 0),
          fixed: String(fees[v]?.fixed ?? 0),
          below: fees[v]?.flatUnder ? String(fees[v]!.flatUnder!.below) : "",
          flat: fees[v]?.flatUnder ? String(fees[v]!.flatUnder!.fee) : "",
          buyerPaid: buyerPaid.includes(v),
        },
      ])
    )
  );
  const [msg, setMsg] = useState<string | null>(null);
  const cell = "border rounded px-2 py-1 w-20 text-right";
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          await post({
            action: "settings",
            settings: {
              fees: Object.fromEntries(
                VENUES.map((v) => [
                  v,
                  {
                    pct: Number(f[v].pct),
                    fixed: Number(f[v].fixed),
                    flatUnder: f[v].below && f[v].flat ? { below: Number(f[v].below), fee: Number(f[v].flat) } : null,
                  },
                ])
              ),
              buyerPaidLabel: VENUES.filter((v) => f[v].buyerPaid),
            },
          });
          setMsg("Saved.");
          router.refresh();
        } catch (x) {
          setMsg(`Failed: ${(x as Error).message}`);
        }
      }}
    >
      <table className="text-sm mb-4">
        <thead>
          <tr className="text-left text-brand-ink/60">
            <th className="py-2 pr-4">Venue</th>
            <th className="py-2 pr-2">% of sale</th>
            <th className="py-2 pr-2">+ per order</th>
            <th className="py-2 pr-2">Flat fee</th>
            <th className="py-2 pr-2">below</th>
            <th className="py-2">Buyer pays label</th>
          </tr>
        </thead>
        <tbody>
          {VENUES.map((v) => {
            const up = (k: string, val: string | boolean) => setF({ ...f, [v]: { ...f[v], [k]: val } });
            return (
              <tr key={v}>
                <td className="py-1 pr-4">{VENUE_LABEL[v]}</td>
                <td className="py-1 pr-2"><input className={cell} value={f[v].pct} onChange={(e) => up("pct", e.target.value)} /></td>
                <td className="py-1 pr-2"><input className={cell} value={f[v].fixed} onChange={(e) => up("fixed", e.target.value)} /></td>
                <td className="py-1 pr-2"><input className={cell} value={f[v].flat} placeholder="—" onChange={(e) => up("flat", e.target.value)} /></td>
                <td className="py-1 pr-2"><input className={cell} value={f[v].below} placeholder="—" onChange={(e) => up("below", e.target.value)} /></td>
                <td className="py-1 text-center"><input type="checkbox" checked={f[v].buyerPaid} onChange={(e) => up("buyerPaid", e.target.checked)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="px-4 py-2 rounded bg-brand-ink text-white text-sm">Save rates</button>
      {msg && <span className="ml-3 text-sm text-brand-ink/70">{msg}</span>}
    </form>
  );
}

/** On a listing draft: which haul it came from (optional) and its own cost. */
export function HaulCostPanel({
  registryItemId,
  hauls,
  acquisitionId,
  unitCost,
  splitCost,
}: {
  registryItemId: string;
  hauls: Array<{ id: string; name: string; acquiredOn: string | null }>;
  acquisitionId: string | null;
  unitCost: number | null;
  splitCost: number | null;
}) {
  const router = useRouter();
  const [acq, setAcq] = useState(acquisitionId ?? "");
  const [cost, setCost] = useState(unitCost == null ? "" : unitCost.toFixed(2));
  const [msg, setMsg] = useState<string | null>(null);
  async function save(next: { acquisitionId?: string | null; unitCost?: string | null }) {
    setMsg(null);
    try {
      await post({ action: "item_cost", ids: [registryItemId], ...next });
      setMsg("Saved.");
      router.refresh();
    } catch (x) {
      setMsg(`Failed: ${(x as Error).message}`);
    }
  }
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-4 text-sm">
      <p className="font-medium mb-2">Haul & cost <span className="font-normal text-brand-ink/50">(optional — for the books)</span></p>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="block text-brand-ink/60 mb-1">Haul</span>
          <select
            className="border rounded px-2 py-1.5 max-w-xs"
            value={acq}
            onChange={(e) => {
              setAcq(e.target.value);
              save({ acquisitionId: e.target.value || null });
            }}
          >
            <option value="">— not tracked —</option>
            {hauls.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
                {h.acquiredOn ? ` (${h.acquiredOn})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-brand-ink/60 mb-1">Its own cost</span>
          <input
            className="border rounded px-2 py-1.5 w-24 text-right"
            inputMode="decimal"
            placeholder={splitCost != null ? `$${splitCost.toFixed(2)}` : "$"}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            onBlur={() => {
              const next = cost.trim() === "" ? null : cost.replace(/[^0-9.]/g, "");
              if ((next ?? null) !== (unitCost == null ? null : unitCost.toFixed(2))) save({ unitCost: next });
            }}
          />
        </label>
        {msg && <span className="text-brand-ink/60">{msg}</span>}
      </div>
      <p className="text-xs text-brand-ink/50 mt-2">
        Leave both blank if you don&apos;t know. With a haul and no cost of its own, the item gets an even share of the
        haul&apos;s total{splitCost != null ? ` (now $${splitCost.toFixed(2)})` : ""}.{" "}
        <a href="/admin/books/hauls" className="underline">Add a haul</a>
      </p>
    </div>
  );
}
