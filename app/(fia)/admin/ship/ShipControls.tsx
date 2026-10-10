"use client";

// Client controls for /admin/ship: start date, sync, the package table with
// selection and pick / invoice / combine / packed / shipped actions.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ShipOrder, ShipTab } from "@/lib/fulfillment/queue";

const VENUE: Record<string, string> = {
  ebay: "eBay",
  mercari: "Mercari",
  poshmark: "Poshmark",
  depop: "Depop",
  whatnot: "Whatnot",
  hip: "Hip",
  tes: "TES",
  fia: "FIA",
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/ship", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string; updated?: number };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

/** Venues that don't print their own packing slip get an FIA/TES invoice. */
export const INVOICE_VENUES = new Set(["mercari", "poshmark", "depop", "tes", "fia"]);

const chicagoToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export function StartForm() {
  const router = useRouter();
  const [date, setDate] = useState(chicagoToday());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await post({ action: "settings", startDate: date });
          router.refresh();
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded px-3 py-2" />
      <button disabled={busy} className="px-4 py-2 rounded bg-brand-ink text-white disabled:opacity-50">
        {busy ? "Starting…" : "Start the queue"}
      </button>
      {err && <span className="text-sm text-red-700">{err}</span>}
    </form>
  );
}

export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/cron/sales-sync", { cache: "no-store" });
          await post({ action: "sync" });
        } finally {
          setBusy(false);
          router.refresh();
        }
      }}
      className="text-sm px-4 py-2 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-50"
    >
      {busy ? "Checking…" : "Check for new sales"}
    </button>
  );
}

const when = (s: string | null) =>
  s ? new Date(s.endsWith("Z") || s.includes("+") ? s : `${s}Z`).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : "";
const money = (n: number) => `$${n.toFixed(2)}`;

export function ShipTable({ orders, tab, startDate }: { orders: ShipOrder[]; tab: ShipTab; startDate: string }) {
  const router = useRouter();
  const fresh = useMemo(
    () => new Set(orders.filter((o) => tab === "to_pick" && !o.pickPrintedAt).map((o) => o.id)),
    [orders, tab]
  );
  const [sel, setSel] = useState<Set<string>>(fresh);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [before, setBefore] = useState(chicagoToday());
  const [armed, setArmed] = useState(false);

  const ids = Array.from(sel).filter((id) => orders.some((o) => o.id === id));
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function act(action: string, only?: string[]) {
    const use = only ?? ids;
    if (!use.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await post({ action, ids: use });
      setMsg(`${r.updated ?? 0} updated.`);
      setSel(new Set());
      router.refresh();
    } catch (x) {
      setMsg(`Failed: ${(x as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function openPickList() {
    if (!ids.length) return;
    window.open(`/admin/ship/pick?ids=${ids.join(",")}`, "_blank");
  }

  function openInvoices() {
    if (!ids.length) return;
    window.open(`/admin/ship/invoices?ids=${ids.join(",")}`, "_blank");
  }

  const needInvoice = orders.filter((o) => INVOICE_VENUES.has(o.venue) && !o.invoicePrintedAt).map((o) => o.id);

  const btn = "text-sm px-3 py-1.5 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-40";
  const primary = "text-sm px-3 py-1.5 rounded bg-brand-ink text-white hover:bg-brand-ink/80 disabled:opacity-40";

  if (!orders.length) {
    return <p className="text-brand-ink/60">Nothing here.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 sticky top-0 bg-white/95 py-2 z-10">
        <span className="text-sm text-brand-ink/70 mr-2">{ids.length} selected</span>
        <button type="button" className={btn} onClick={() => setSel(new Set(orders.map((o) => o.id)))}>
          All
        </button>
        <button type="button" className={btn} onClick={() => setSel(new Set())}>
          None
        </button>
        {tab === "to_pick" && (
          <>
            <button type="button" className={btn} onClick={() => setSel(new Set(fresh))}>
              Not yet on a pick list
            </button>
            <button type="button" className={primary} disabled={!ids.length} onClick={openPickList}>
              Print pick list
            </button>
            <button type="button" className={btn} onClick={() => setSel(new Set(needInvoice))}>
              Need an invoice ({needInvoice.length})
            </button>
            <button type="button" className={primary} disabled={!ids.length} onClick={openInvoices}>
              Print invoices
            </button>
            <button type="button" className={btn} disabled={busy || ids.length < 2} onClick={() => act("combine")}>
              Combine selected
            </button>
            <button type="button" className={btn} disabled={busy || !ids.length} onClick={() => act("packed")}>
              Mark packed
            </button>
          </>
        )}
        {(tab === "to_pick" || tab === "packed") && (
          <>
            <button type="button" className={btn} disabled={busy || !ids.length} onClick={() => act("shipped")}>
              Mark shipped
            </button>
            <button type="button" className={btn} disabled={busy || !ids.length} onClick={() => act("cancel")}>
              Cancel
            </button>
          </>
        )}
        {tab !== "to_pick" && (
          <button type="button" className={btn} disabled={busy || !ids.length} onClick={() => act("reopen")}>
            Back to “to pick”
          </button>
        )}
        {msg && <span className="text-sm text-brand-ink/70">{msg}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-brand-ink/60 border-b">
              <th className="py-2 w-8"></th>
              <th className="py-2 w-16"></th>
              <th className="py-2">Item</th>
              <th className="py-2">Bin</th>
              <th className="py-2">Venue</th>
              <th className="py-2">Sold</th>
              <th className="py-2 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const total = o.orderTotal ?? o.lines.reduce((a, l) => a + (l.price ?? 0) * l.quantity, 0);
              const img = o.lines.find((l) => l.imageUrl)?.imageUrl;
              return (
                <tr key={o.id} className="border-b align-top hover:bg-brand-ink/5 cursor-pointer" onClick={() => toggle(o.id)}>
                  <td className="py-2">
                    <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="py-2">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" className="w-12 h-12 object-cover rounded" loading="lazy" />
                    ) : (
                      <div className="w-12 h-12 rounded bg-brand-ink/10" />
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {o.lines.map((l) => (
                      <div key={l.id}>
                        {l.quantity > 1 && <span className="font-semibold">{l.quantity}× </span>}
                        {l.title ?? "(no title)"}
                        {!l.registryItemId && (
                          <a href="/admin/sales" className="ml-2 text-xs text-amber-700 underline" onClick={(e) => e.stopPropagation()}>
                            not matched
                          </a>
                        )}
                      </div>
                    ))}
                    {(o.buyerUsername || o.buyerName) && (
                      <div className="text-xs text-brand-ink/50">
                        {o.buyerUsername && o.venue !== "tes" && o.venue !== "fia" ? `@${o.buyerUsername}` : ""}
                        {o.buyerUsername && o.buyerName ? " · " : ""}
                        {o.buyerName ?? ""}
                        {o.lines.length > 1 && <span className="ml-2">{o.lines.length} items, one package</span>}
                      </div>
                    )}
                    {o.sameBuyer.length > 0 && (
                      <div className="text-xs mt-1">
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Same buyer as {o.sameBuyer.length} other package{o.sameBuyer.length === 1 ? "" : "s"}
                        </span>
                        <button
                          type="button"
                          className="ml-2 underline text-amber-800 disabled:opacity-40"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            act("combine", [o.id, ...o.sameBuyer]);
                          }}
                        >
                          Combine
                        </button>
                      </div>
                    )}
                    {o.invoicePrintedAt && tab === "to_pick" && (
                      <div className="text-xs text-brand-ink/50">invoice printed {when(o.invoicePrintedAt)}</div>
                    )}
                    {o.pickPrintedAt && tab === "to_pick" && (
                      <div className="text-xs text-brand-ink/50">on a pick list {when(o.pickPrintedAt)}</div>
                    )}
                  </td>
                  <td className="py-2 font-mono whitespace-nowrap">
                    {o.lines.map((l) => (
                      <div key={l.id}>{l.binSku ?? <span className="text-amber-700 font-sans text-xs">no bin</span>}</div>
                    ))}
                  </td>
                  <td className="py-2 whitespace-nowrap">{VENUE[o.venue] ?? o.venue}</td>
                  <td className="py-2 whitespace-nowrap">{when(o.soldAt)}</td>
                  <td className="py-2 text-right whitespace-nowrap">{total > 0 ? money(total) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {tab === "to_pick" && (
        <form
          className="mt-8 flex flex-wrap items-center gap-2 text-sm text-brand-ink/70"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!armed) {
              setArmed(true);
              setMsg(`Click “as shipped” again to mark every package sold before ${before} shipped.`);
              return;
            }
            setArmed(false);
            setBusy(true);
            try {
              const r = await post({ action: "shipped_before", date: before });
              setMsg(`${r.updated ?? 0} marked shipped.`);
              router.refresh();
            } catch (x) {
              setMsg(`Failed: ${(x as Error).message}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span>Already packed these through Nifty? Mark everything sold before</span>
          <input type="date" min={startDate} value={before} onChange={(e) => {
              setBefore(e.target.value);
              setArmed(false);
            }} className="border rounded px-2 py-1" />
          <button className={armed ? primary : btn} disabled={busy}>
            as shipped
          </button>
        </form>
      )}
    </div>
  );
}
