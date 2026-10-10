"use client";

// Edit FIA's record of one item: title, bin, status (sold venue), notes.
// Saved fields are kept by FIA — the hourly Nifty sync won't overwrite
// them — until "Use Nifty's again" hands one back.

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = [
  { v: "live", label: "Active" },
  { v: "sold", label: "Sold" },
  { v: "archived", label: "Delisted" },
  { v: "draft", label: "Draft" },
];
const VENUES = ["ebay", "mercari", "poshmark", "depop", "whatnot", "etsy", "hip", "tes", "fia"];
const VENUE_NAME: Record<string, string> = {
  ebay: "eBay", mercari: "Mercari", poshmark: "Poshmark", depop: "Depop", whatnot: "Whatnot", etsy: "Etsy",
  hip: "HipPostcard", tes: "The Ephemeral State", fia: "Found in Alabama",
};
const FIELD: Record<string, string> = { title: "title", bin_sku: "bin", status: "status" };

export function ItemEditor(props: {
  id: string;
  title: string;
  binSku: string | null;
  status: string;
  soldOnVenue: string | null;
  notes: string | null;
  locked: string[];
  niftyTitle: string | null;
  niftySku: string | null;
  ready: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(props.title);
  const [bin, setBin] = useState(props.binSku ?? "");
  const [status, setStatus] = useState(props.status);
  const [soldOn, setSoldOn] = useState(props.soldOnVenue ?? "");
  const [notes, setNotes] = useState(props.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function post(body: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/inventory/${props.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      return out as { changed?: string[] };
    } catch (err) {
      setMsg((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const out = await post({ action: "save", title, binSku: bin, status, soldOnVenue: soldOn || null, notes });
    if (out) {
      setMsg(out.changed?.length ? `Saved: ${out.changed.join(", ").replace("bin_sku", "bin").replace("sold_on_venue", "sold on")}.` : "No changes.");
      router.refresh();
    }
  }

  async function unlock(field: string) {
    if (await post({ action: "unlock", field })) {
      setMsg(`The ${FIELD[field]} will follow Nifty again from the next sync.`);
      router.refresh();
    }
  }

  const dirty =
    title !== props.title || bin !== (props.binSku ?? "") || status !== props.status || notes !== (props.notes ?? "") ||
    (status === "sold" && soldOn !== (props.soldOnVenue ?? ""));

  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-4 text-sm">
      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">Edit FIA&apos;s record</h2>
      {!props.ready && <p className="mb-3 text-red-700">Run <code>npm run db:migrate</code> (migration 0041) to enable editing.</p>}
      <label className="block mb-3">
        <span className="block text-xs text-brand-ink/60 mb-1">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="w-full border rounded px-2 py-1.5" />
        <span className="text-xs text-brand-ink/50">{title.length}/80 for eBay</span>
      </label>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label>
          <span className="block text-xs text-brand-ink/60 mb-1">Bin</span>
          <input value={bin} onChange={(e) => setBin(e.target.value)} maxLength={40} className="w-full border rounded px-2 py-1.5 font-mono" />
        </label>
        <label>
          <span className="block text-xs text-brand-ink/60 mb-1">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full border rounded px-2 py-1.5">
            {STATUSES.map((s) => (
              <option key={s.v} value={s.v}>{s.label}</option>
            ))}
            {!STATUSES.some((s) => s.v === props.status) && <option value={props.status}>{props.status}</option>}
          </select>
        </label>
      </div>
      {status === "sold" && (
        <label className="block mb-3">
          <span className="block text-xs text-brand-ink/60 mb-1">Sold on</span>
          <select value={soldOn} onChange={(e) => setSoldOn(e.target.value)} className="w-full border rounded px-2 py-1.5">
            <option value="">(unknown)</option>
            {VENUES.map((v) => (
              <option key={v} value={v}>{VENUE_NAME[v]}</option>
            ))}
          </select>
        </label>
      )}
      <label className="block mb-3">
        <span className="block text-xs text-brand-ink/60 mb-1">Notes (FIA only)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full border rounded px-2 py-1.5" />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy || !dirty || !props.ready} className="px-4 py-1.5 rounded bg-brand-ink text-white disabled:opacity-40">
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-brand-ink/70">{msg}</span>}
      </div>
      <p className="text-xs text-brand-ink/50 mt-3">
        Saving changes FIA&apos;s record only; eBay, Nifty and the other venues keep what they have for now. Once FIA takes over
        listing from Nifty, these edits will go out to the venues the item is live on.
      </p>
      {props.locked.length > 0 && (
        <div className="mt-3 text-xs border-t border-brand-ink/10 pt-3 space-y-1">
          {props.locked.map((f) => (
            <p key={f}>
              FIA keeps your {FIELD[f] ?? f}
              {f === "title" && props.niftyTitle && props.niftyTitle !== props.title && <> (Nifty has &ldquo;{props.niftyTitle}&rdquo;)</>}
              {f === "bin_sku" && props.niftySku !== props.binSku && <> (Nifty has {props.niftySku ?? "none"})</>}.{" "}
              <button type="button" onClick={() => unlock(f)} disabled={busy} className="underline">
                Use Nifty&apos;s again
              </button>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
