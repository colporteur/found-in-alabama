"use client";

// Hand-editing for a listing draft (Phase LIST-1). The AI writer (LIST-2)
// fills the same fields; anything typed here is kept and marked as written
// by hand.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Fields = {
  title: string;
  description: string;
  condition: string;
  conditionNote: string;
  ebayCategoryId: string;
  ebayCategoryName: string;
  itemSpecifics: string;
  price: string;
  binSku: string;
  weightOz: string;
  quantity: string;
  notes: string;
};

const CONDITIONS = ["Used", "Pre-owned - Good", "Pre-owned - Fair", "Like New", "New", "For parts or not working"];
const EDITABLE = new Set(["uploading", "ready", "review", "sent_back"]);

export function DraftEditor({ id, status, initial }: { id: string; status: string; initial: Fields }) {
  const router = useRouter();
  const [f, setF] = useState<Fields>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const editable = EDITABLE.has(status);
  const set = (k: keyof Fields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/listings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      setMsg("Saved.");
      router.refresh();
    } catch (err) {
      setMsg(`Not saved: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function act(action: "discard" | "restore") {
    if (action === "discard" && !confirm("Discard this draft? The photos stay in storage; you can restore it later.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/listings/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setMsg(`Failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full border border-brand-ink/20 rounded px-2 py-1 text-sm disabled:bg-brand-ink/5";
  const label = "block text-xs uppercase tracking-wider text-brand-ink/50 mb-1";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <div>
          <label className={label}>
            Title <span className="normal-case">({f.title.length}/80)</span>
          </label>
          <input className={input} maxLength={80} value={f.title} onChange={set("title")} disabled={!editable} />
        </div>
        <div>
          <label className={label}>
            Description{" "}
            <span className="normal-case">
              ({f.description.length} characters — the first ~1,000 must stand alone for Mercari and Depop)
            </span>
          </label>
          <textarea className={`${input} h-64 font-mono`} value={f.description} onChange={set("description")} disabled={!editable} />
        </div>
        <div>
          <label className={label}>Item specifics (one per line, “Name: value”; several values with “ | ”)</label>
          <textarea className={`${input} h-40 font-mono`} value={f.itemSpecifics} onChange={set("itemSpecifics")} disabled={!editable} />
        </div>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Price ($)</label>
            <input className={input} inputMode="decimal" value={f.price} onChange={set("price")} disabled={!editable} />
          </div>
          <div>
            <label className={label}>Quantity</label>
            <input className={input} inputMode="numeric" value={f.quantity} onChange={set("quantity")} disabled={!editable} />
          </div>
          <div>
            <label className={label}>Bin (SKU)</label>
            <input className={input} value={f.binSku} onChange={set("binSku")} disabled={!editable} />
          </div>
          <div>
            <label className={label}>Weight (oz)</label>
            <input className={input} inputMode="decimal" value={f.weightOz} onChange={set("weightOz")} disabled={!editable} />
          </div>
        </div>
        <div>
          <label className={label}>Condition</label>
          <input className={input} list="conditions" value={f.condition} onChange={set("condition")} disabled={!editable} />
          <datalist id="conditions">
            {CONDITIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={label}>Condition note</label>
          <textarea className={`${input} h-20`} value={f.conditionNote} onChange={set("conditionNote")} disabled={!editable} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={label}>eBay cat. id</label>
            <input className={input} value={f.ebayCategoryId} onChange={set("ebayCategoryId")} disabled={!editable} />
          </div>
          <div className="col-span-2">
            <label className={label}>eBay category</label>
            <input className={input} value={f.ebayCategoryName} onChange={set("ebayCategoryName")} disabled={!editable} />
          </div>
        </div>
        <div>
          <label className={label}>Notes for the writer (private)</label>
          <textarea className={`${input} h-24`} value={f.notes} onChange={set("notes")} disabled={!editable} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {editable && (
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="text-sm px-4 py-2 rounded font-medium bg-brand-ink text-white hover:bg-brand-ink/80 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          )}
          {status === "discarded" ? (
            <button type="button" onClick={() => act("restore")} disabled={busy} className="text-sm px-3 py-2 rounded border border-brand-ink/20">
              Restore
            </button>
          ) : (
            !["approved", "published"].includes(status) && (
              <button type="button" onClick={() => act("discard")} disabled={busy} className="text-sm px-3 py-2 rounded border border-brand-ink/20 text-red-800">
                Discard
              </button>
            )
          )}
          {msg && <span className="text-sm text-brand-ink/70">{msg}</span>}
        </div>
        <p className="text-xs text-brand-ink/50">
          Approving and sending to Nifty come in the next steps. Nothing on this page publishes anything.
        </p>
      </div>
    </div>
  );
}
