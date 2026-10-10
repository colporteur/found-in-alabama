"use client";

// Client controls for /admin/stale: pick due items and hand them to Expert
// Enhance, make lot drafts, edit the rhythm settings.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StaleItem } from "@/lib/stale/report";
import type { StaleAction, StaleSettings } from "@/lib/stale/rules";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/stale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as {
    error?: string;
    draftId?: string;
    batches?: Array<{ op: string; items: number }>;
    recorded?: number;
  };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

const money = (n: number | null) => (n == null ? "" : `$${n.toFixed(2)}`);
const day = (s: string | null) =>
  s ? new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—";

export function StaleTable({
  items,
  action,
  families,
  markdownPct,
}: {
  items: StaleItem[];
  action: StaleAction;
  families: string[];
  markdownPct: number;
}) {
  const router = useRouter();
  const [count, setCount] = useState(Math.min(50, items.length));
  const [sel, setSel] = useState<Set<string>>(new Set(items.slice(0, Math.min(50, items.length)).map((i) => i.itemId)));
  const [family, setFamily] = useState(families.includes("Postcards") ? "Postcards" : families[0] ?? "");
  const [specifics, setSpecifics] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ids = items.filter((i) => sel.has(i.itemId)).map((i) => i.itemId);
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function run(kind: "rewrite" | "describe" | "markdown" | "skip") {
    if (!ids.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await post({ action: "run", kind, itemIds: ids, guideId: family ? `family:${family}` : null, fillSpecifics: specifics });
      fetch("/api/cron/enhance").catch(() => {});
      setMsg(
        kind === "skip"
          ? `${r.recorded} left as they are for this round.`
          : `Queued ${r.batches?.map((b) => `${b.op.replace("_", " ")} (${b.items})`).join(" + ")}. Follow it in eBay → Enhance; each change can be rolled back there.`
      );
      setSel(new Set());
      router.refresh();
    } catch (x) {
      setMsg(`Failed: ${(x as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!items.length) return <p className="text-sm text-brand-ink/60">Nothing due for this action.</p>;
  const btn = "text-sm px-3 py-1.5 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-40";
  const primary = "text-sm px-3 py-1.5 rounded bg-brand-ink text-white hover:bg-brand-ink/80 disabled:opacity-40";

  return (
    <div>
      <div className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="block text-brand-ink/60 mb-1">Oldest</span>
          <input
            type="number"
            min={1}
            max={items.length}
            value={count}
            onChange={(e) => {
              const n = Math.max(1, Math.min(items.length, Number(e.target.value) || 1));
              setCount(n);
              setSel(new Set(items.slice(0, n).map((i) => i.itemId)));
            }}
            className="border rounded px-2 py-1.5 w-20"
          />
        </label>
        {(action === "rewrite" || action === "describe") && (
          <label>
            <span className="block text-brand-ink/60 mb-1">Expert Guide family (routes per listing)</span>
            <select value={family} onChange={(e) => setFamily(e.target.value)} className="border rounded px-2 py-1.5">
              {families.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        )}
        {action === "rewrite" && (
          <label className="flex items-center gap-1 pb-2">
            <input type="checkbox" checked={specifics} onChange={(e) => setSpecifics(e.target.checked)} /> also fill empty item specifics
          </label>
        )}
        <button
          type="button"
          className={primary}
          disabled={busy || !ids.length || ((action === "rewrite" || action === "describe") && !family)}
          onClick={() => run(action === "markdown" ? "markdown" : action === "describe" ? "describe" : "rewrite")}
        >
          {busy
            ? "Queuing…"
            : action === "markdown"
              ? `Mark down ${ids.length} by ${markdownPct}%`
              : action === "describe"
                ? `Rewrite ${ids.length} descriptions`
                : `Rewrite ${ids.length} titles${specifics ? " + specifics" : ""}`}
        </button>
        <button type="button" className={btn} disabled={busy || !ids.length} onClick={() => run("skip")}>
          Leave as is this round
        </button>
        {msg && <span className="text-brand-ink/70 basis-full">{msg}</span>}
        <span className="text-xs text-brand-ink/50 basis-full">
          Changes go to the live eBay listing (other venues keep their text until Nifty re-syncs them). AI rewrites
          cost a little per item; the Enhance page shows the estimate and the rollback.
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-ink/60 border-b">
            <th className="py-2 w-8"></th>
            <th className="py-2 w-14"></th>
            <th className="py-2">Item</th>
            <th className="py-2">Bin</th>
            <th className="py-2">Since</th>
            <th className="py-2 text-right">Rounds</th>
            <th className="py-2 text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.itemId} className="border-b hover:bg-brand-ink/5 cursor-pointer" onClick={() => toggle(i.itemId)}>
              <td className="py-2">
                <input type="checkbox" checked={sel.has(i.itemId)} onChange={() => toggle(i.itemId)} onClick={(e) => e.stopPropagation()} />
              </td>
              <td className="py-2">
                {i.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.imageUrl} alt="" className="w-10 h-10 object-cover rounded" loading="lazy" />
                ) : (
                  <div className="w-10 h-10 rounded bg-brand-ink/10" />
                )}
              </td>
              <td className="py-2 pr-4">
                <a href={`https://www.ebay.com/itm/${i.itemId}`} target="_blank" rel="noreferrer" className="hover:underline" onClick={(e) => e.stopPropagation()}>
                  {i.title}
                </a>
              </td>
              <td className="py-2 pr-4 font-mono whitespace-nowrap">{i.sku ?? ""}</td>
              <td className="py-2 pr-4 whitespace-nowrap" title={i.lastShake ? "last shake-up" : "first seen"}>
                {day(i.lastShake ?? i.firstSeen)}
              </td>
              <td className="py-2 text-right">{i.rounds}</td>
              <td className="py-2 text-right whitespace-nowrap">
                {money(i.price)}
                {i.newPrice != null && <span className="text-brand-ink/50"> → {money(i.newPrice)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BundleList({
  bundles,
  minItems,
}: {
  bundles: Array<{ bin: string; count: number; total: number; itemIds: string[]; titles: string[] }>;
  minItems: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  if (!bundles.length) {
    return <p className="text-sm text-brand-ink/60">No bin has {minItems}+ lot candidates yet.</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {bundles.map((b) => (
        <div key={b.bin} className="bg-white border border-brand-ink/15 rounded-lg p-4 text-sm">
          <div className="flex justify-between items-baseline mb-2">
            <p className="font-semibold">
              Bin <span className="font-mono">{b.bin}</span> · {b.count} items
            </p>
            <span className="text-brand-ink/60">singles total ${b.total.toFixed(2)}</span>
          </div>
          <ul className="text-xs text-brand-ink/70 mb-3 max-h-32 overflow-auto list-disc pl-4">
            {b.titles.slice(0, 20).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
            {b.titles.length > 20 && <li>…and {b.titles.length - 20} more</li>}
          </ul>
          <button
            type="button"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(b.bin);
              try {
                const r = await post({ action: "lot", itemIds: b.itemIds.slice(0, 40) });
                setMsg((m) => ({ ...m, [b.bin]: `Lot draft made — open it in Listings (${r.draftId?.slice(0, 8)}).` }));
                router.refresh();
              } catch (x) {
                setMsg((m) => ({ ...m, [b.bin]: `Failed: ${(x as Error).message}` }));
              } finally {
                setBusy(null);
              }
            }}
            className="text-sm px-3 py-1.5 rounded bg-brand-ink text-white disabled:opacity-40"
          >
            {busy === b.bin ? "Making…" : `Make a lot draft (${Math.min(b.count, 40)})`}
          </button>
          {msg[b.bin] && (
            <p className="text-xs mt-2">
              {msg[b.bin]} <a href="/admin/listings" className="underline">Listings</a>
            </p>
          )}
        </div>
      ))}
      <p className="text-xs text-brand-ink/50 md:col-span-2">
        A lot draft uses the singles&apos; eBay photos to start (swap in a group photo if you take one) and lists the
        items in its notes. Nothing ends on eBay until you end the singles yourself when the lot goes live.
      </p>
    </div>
  );
}

export function StaleSettingsForm({ settings }: { settings: StaleSettings }) {
  const router = useRouter();
  const [f, setF] = useState(Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, String(v)])) as Record<string, string>);
  const [msg, setMsg] = useState<string | null>(null);
  const fields: Array<[keyof StaleSettings, string]> = [
    ["cycleDays", "Days between shake-ups"],
    ["markdownPct", "Markdown %"],
    ["floor", "Price floor $"],
    ["bundleMaxPrice", "Lot candidates at or under $"],
    ["bundleAfterRounds", "…after this many rounds"],
    ["bundleMinItems", "Items per bin to suggest a lot"],
  ];
  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await post({ action: "settings", settings: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])) });
          setMsg("Saved.");
          router.refresh();
        } catch (x) {
          setMsg(`Failed: ${(x as Error).message}`);
        }
      }}
    >
      {fields.map(([k, label]) => (
        <label key={k}>
          <span className="block text-brand-ink/60 mb-1">{label}</span>
          <input className="border rounded px-2 py-1.5 w-24" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        </label>
      ))}
      <button className="px-4 py-2 rounded bg-brand-ink text-white">Save</button>
      {msg && <span className="text-brand-ink/70">{msg}</span>}
    </form>
  );
}
