"use client";

// The lot pool board: each forming lot with its pieces, estimated values,
// age and controls (list now, rename, suggested price, allow mixing, take a
// piece out, release it), the pieces not in a lot yet, and the pieces still
// to go into the physical LOTPOOL bin.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PoolGroup, PoolMember } from "@/lib/listings/pool";

const AGING_DAYS = 60;
const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const BTN = "text-xs px-2 py-1 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-40";
const VENUE: Record<string, string> = { ebay: "eBay", mercari: "Mercari", poshmark: "Poshmark", depop: "Depop", whatnot: "Whatnot", etsy: "Etsy", hip: "HipPostcard" };

type Ctx = {
  busy: boolean;
  picked: Set<string>;
  toggle: (id: string) => void;
  act: (body: Record<string, unknown>, done?: (out: Record<string, unknown>) => string | null) => void;
};

function Piece({ m, ctx }: { m: PoolMember; ctx: Ctx }) {
const { busy, picked, toggle, act } = ctx;
const btn = BTN;
  return (
    <div className={`flex gap-3 items-start border rounded p-2 bg-white ${picked.has(m.id) ? "border-green-800 ring-1 ring-green-800/30" : "border-brand-ink/10"}`}>
      <input type="checkbox" className="mt-1" checked={picked.has(m.id)} onChange={() => toggle(m.id)} aria-label="Pick" />
      {m.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.photoUrl} alt="" style={{ width: 56, height: 56, maxWidth: "none" }} className="object-cover rounded border border-brand-ink/10" />
      ) : (
        <span className="block w-14 h-14 rounded bg-brand-ink/5" />
      )}
      <div className="flex-1 min-w-0 text-sm">
        <p className="font-medium line-clamp-2">
          {m.draftId ? (
            <Link href={`/admin/listings/${m.draftId}`} className="hover:underline">{m.title ?? "Untitled"}</Link>
          ) : m.registryItemId ? (
            <Link href={`/admin/inventory/${m.registryItemId}`} className="hover:underline">{m.title ?? "Untitled"}</Link>
          ) : (
            m.title ?? "Untitled"
          )}
        </p>
        {m.identification && <p className="text-xs text-brand-ink/60 line-clamp-2">{m.identification}</p>}
        <p className="text-xs text-brand-ink/60 mt-0.5">
          {m.kind === "candidate" ? (
            <span className="rounded bg-amber-100 text-amber-900 px-1">still listed</span>
          ) : (
            <span className="rounded bg-purple-100 text-purple-900 px-1">pooled</span>
          )}{" "}
          {m.isPostcard ? "postcard · " : ""}est. {money(m.estValue)} ·{" "}
          <span className={m.days >= AGING_DAYS ? "text-red-800 font-medium" : ""}>{m.days} day{m.days === 1 ? "" : "s"} waiting</span>
          {m.note && <> · {m.note}</>}
        </p>
        {m.kind === "candidate" && (
          <div className="text-xs mt-1">
            {m.venues.length ? (
              <span>
                Delist by hand on:{" "}
                {m.venues.map((v, i) => (
                  <span key={v.venue + i}>
                    {i ? ", " : ""}
                    {v.url ? (
                      <a href={v.url} target="_blank" rel="noreferrer" className="underline">{VENUE[v.venue] ?? v.venue}</a>
                    ) : (
                      VENUE[v.venue] ?? v.venue
                    )}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-brand-ink/50">No live listings on record.</span>
            )}
            <label className="ml-3 inline-flex items-center gap-1">
              <input type="checkbox" checked={m.delisted} disabled={busy} onChange={(e) => act({ action: "delisted", memberId: m.id, done: e.target.checked })} />
              delisted everywhere
            </label>
          </div>
        )}
      </div>
      <button
        type="button"
        className={btn}
        disabled={busy}
        onClick={() => {
          if (confirm(m.kind === "candidate" ? "Take this out of the lot pool? It stays listed on its own." : "Take this out of the lot pool and back to its own listing?"))
            act({ action: "release", memberId: m.id }, (o) => (o.note as string | null) ?? "Taken out of the pool.");
        }}
      >
        Release
      </button>
    </div>
  );
}


function Group({ g, ctx }: { g: PoolGroup; ctx: Ctx }) {
const { busy, act } = ctx;
const btn = BTN;
  const [name, setName] = useState(g.name);
  const [price, setPrice] = useState(g.suggestedPrice != null ? g.suggestedPrice.toFixed(2) : "");
  const waiting = g.members.filter((m) => m.kind === "candidate" && !m.delisted).length;
  const postcards = g.members.filter((m) => m.isPostcard).length;
  return (
    <div className="border-2 border-purple-700/40 rounded-lg p-3 bg-purple-50/40">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== g.name && act({ action: "group", groupId: g.id, name })}
          className="font-semibold bg-transparent border border-transparent hover:border-brand-ink/20 rounded px-1 flex-1 min-w-[12rem]"
        />
        <span className="text-sm text-brand-ink/70">
          {g.members.length} piece{g.members.length === 1 ? "" : "s"} · est. {money(g.estTotal)} ·{" "}
          <span className={g.oldestDays >= AGING_DAYS ? "text-red-800 font-medium" : ""}>oldest {g.oldestDays} days</span>
          {postcards > 0 && postcards < g.members.length && <> · mixed</>}
        </span>
      </div>
      {g.reason && <p className="text-xs text-brand-ink/70 mb-2">Why: {g.reason}</p>}
      <div className="grid gap-2 md:grid-cols-2 mb-3">
        {g.members.map((m) => (
          <Piece key={m.id} m={m} ctx={ctx} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          Suggested lot price $
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => act({ action: "group", groupId: g.id, suggestedPrice: price.trim() ? Number(price.replace(/[$,]/g, "")) : null })}
            inputMode="decimal"
            className="w-20 border border-brand-ink/20 rounded px-1"
          />
        </label>
        <label className="flex items-center gap-1" title="Postcards stay with postcards unless this is on">
          <input type="checkbox" checked={g.allowMix} disabled={busy} onChange={(e) => act({ action: "group", groupId: g.id, allowMix: e.target.checked })} /> allow mixing
          postcards with other things
        </label>
        <button
          type="button"
          disabled={busy || g.members.length < 2 || waiting > 0}
          title={waiting ? "Delist the still-listed pieces everywhere first and tick 'delisted everywhere'" : "Build the lot draft (cover from the fronts) and queue it for Claude to write"}
          onClick={() => confirm(`List "${g.name}" now as one lot of ${g.members.length}?`) && act({ action: "list", groupId: g.id }, (o) => `Lot draft made and queued for Claude — open it: /admin/listings/${o.lotDraftId}`)}
          className="px-3 py-1.5 rounded bg-purple-700 text-white disabled:opacity-40"
        >
          List this lot now
        </button>
        {waiting > 0 && <span className="text-xs text-amber-900">{waiting} still listed — delist first</span>}
        <button type="button" className={btn} disabled={busy} onClick={() => confirm("Break up this lot? The pieces stay in the pool.") && act({ action: "dissolve", groupId: g.id })}>
          Break up
        </button>
      </div>
    </div>
  );
}


export function PoolBoard({ pool }: { pool: { groups: PoolGroup[]; loose: PoolMember[]; toMove: PoolMember[] } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  async function act(body: Record<string, unknown>, done?: (out: Record<string, unknown>) => string | null) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      setMsg(done?.(out) ?? null);
      setPicked(new Set());
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pickedIds = Array.from(picked);
  const btn = BTN;
  const ctx: Ctx = { busy, picked, toggle, act };

  return (
    <div className="space-y-8">
      {msg && <p className="text-sm rounded border border-brand-ink/20 bg-white p-2">{msg}</p>}

      {pool.toMove.length > 0 && (
        <div className="rounded-lg border-2 border-amber-600 bg-amber-50 p-3 text-sm">
          <p className="font-semibold mb-1">Put these in the LOTPOOL bin ({pool.toMove.length})</p>
          <ul className="list-disc pl-5 mb-2">
            {pool.toMove.map((m) => (
              <li key={m.id}>
                {m.title ?? "Untitled"}
                {m.prevBin && <span className="font-mono text-xs"> (from bin {m.prevBin})</span>}
              </li>
            ))}
          </ul>
          <button type="button" className={btn} disabled={busy} onClick={() => act({ action: "moved", memberIds: pool.toMove.map((m) => m.id) }, (o) => `Marked ${o.moved} as moved.`)}>
            Done — they&apos;re all in LOTPOOL
          </button>
        </div>
      )}

      {pickedIds.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded border border-green-800 bg-white p-2 text-sm shadow">
          <span>{pickedIds.length} picked:</span>
          <select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              if (v === "__new") {
                const n = prompt("Name for the new lot (e.g. St. Louis souvenir brochures)");
                if (n?.trim()) act({ action: "assign", memberIds: pickedIds, newGroup: n.trim() });
              } else if (v === "__out") act({ action: "assign", memberIds: pickedIds });
              else if (v) act({ action: "assign", memberIds: pickedIds, groupId: v });
            }}
            className="border border-brand-ink/20 rounded px-2 py-1"
          >
            <option value="">Move to a lot…</option>
            {pool.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="__new">+ New lot…</option>
            <option value="__out">Not in a lot</option>
          </select>
          <button type="button" className={btn} onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Lots being formed ({pool.groups.length})</h2>
        {pool.groups.length === 0 && <p className="text-sm text-brand-ink/60">None yet. Pick pieces below and choose &ldquo;+ New lot…&rdquo;.</p>}
        {pool.groups.map((g) => (
          <Group key={g.id} g={g} ctx={ctx} />
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Not in a lot yet ({pool.loose.length})</h2>
        {pool.loose.length === 0 ? (
          <p className="text-sm text-brand-ink/60">Nothing waiting.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {pool.loose.map((m) => (
              <Piece key={m.id} m={m} ctx={ctx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
