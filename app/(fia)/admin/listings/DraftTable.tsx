"use client";

// Spreadsheet view of the listings queue: small thumbnails and the fields
// Todd adjusts most — title (wrapping), price, bin, weight, the two eBay
// store shelves, shipping profile, quantity — editable in place. Changed cells
// are highlighted; save a row, or every changed row at once. Only drafts
// that can still be edited (ready / to review / sent back) take edits.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftSummary } from "@/lib/listings/drafts";
import { MinPriceControl } from "./MinPriceControl";
import { ShelfControl } from "./ShelfControl";
import { ApproveControl } from "./ApproveControl";

const EDITABLE = new Set(["uploading", "ready", "review", "sent_back"]);
const STATUS_LABEL: Record<string, string> = {
  uploading: "Uploading",
  ready: "Ready",
  generating: "Writing",
  review: "To review",
  approved: "Approved",
  in_nifty: "In Nifty",
  published: "Published",
  sent_back: "Sent back",
  with_claude: "With Claude",
  discarded: "Discarded",
};

type Row = {
  title: string;
  price: string;
  binSku: string;
  weightOz: string;
  shelf1: string;
  shelf2: string;
  shippingProfile: string;
  quantity: string;
};
const FIELDS: Array<keyof Row> = ["title", "price", "binSku", "weightOz", "shelf1", "shelf2", "shippingProfile", "quantity"];

const toRow = (d: DraftSummary): Row => ({
  title: d.title ?? "",
  price: d.price != null ? d.price.toFixed(2) : "",
  binSku: d.binSku ?? "",
  weightOz: d.weightOz != null ? String(d.weightOz) : "",
  shelf1: d.storeCategoryIds[0] ?? "",
  shelf2: d.storeCategoryIds[1] ?? "",
  shippingProfile: d.shippingProfile ?? "",
  quantity: String(d.quantity ?? 1),
});

export function DraftTable({ drafts, shelves }: { drafts: DraftSummary[]; shelves: Array<{ id: string; path: string }> }) {
  const router = useRouter();
  const start = useMemo(() => Object.fromEntries(drafts.map((d) => [d.id, toRow(d)])), [drafts]);
  const [rows, setRows] = useState<Record<string, Row>>(start);
  // After a save or a bulk change (router.refresh) the server values change:
  // take them for every cell that wasn't being edited, keep unsaved edits.
  const prevStart = useRef(start);
  useEffect(() => {
    const old = prevStart.current;
    prevStart.current = start;
    if (old === start) return;
    setRows((cur) => {
      const next: Record<string, Row> = {};
      for (const [id, fresh] of Object.entries(start)) {
        const mine = cur[id];
        const before = old[id];
        if (!mine || !before) {
          next[id] = fresh;
          continue;
        }
        const merged = { ...fresh };
        for (const f of FIELDS) if (mine[f] !== before[f]) merged[f] = mine[f];
        next[id] = merged;
      }
      return next;
    });
  }, [start]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const shelfPath = useMemo(() => new Map(shelves.map((c) => [c.id, c.path])), [shelves]);

  const changed = (id: string) => FIELDS.filter((f) => rows[id]?.[f] !== start[id]?.[f]);
  const dirtyIds = drafts.filter((d) => changed(d.id).length > 0).map((d) => d.id);
  const editableIds = drafts.filter((d) => EDITABLE.has(d.status)).map((d) => d.id);
  const pickableIds = drafts.filter((d) => EDITABLE.has(d.status) || d.status === "approved").map((d) => d.id);

  const set = (id: string, f: keyof Row) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], [f]: e.target.value } }));

  async function saveRow(id: string): Promise<boolean> {
    const fields = changed(id);
    if (!fields.length) return true;
    const r = rows[id];
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      if (f === "title") body.title = r.title.replace(/\s+/g, " ").trim();
      if (f === "price") body.price = r.price.trim() ? Number(r.price.replace(/[$,]/g, "")) : null;
      if (f === "shelf1" || f === "shelf2") body.storeCategoryIds = [r.shelf1, r.shelf2].filter(Boolean);
      if (f === "binSku") body.binSku = r.binSku;
      if (f === "weightOz") body.weightOz = r.weightOz.trim() ? Number(r.weightOz) : null;
      if (f === "quantity") body.quantity = Number(r.quantity) || 1;
      if (f === "shippingProfile") body.shippingProfile = r.shippingProfile || null;
    }
    setSaving((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/admin/listings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      setErrors((e) => {
        const n = { ...e };
        delete n[id];
        return n;
      });
      return true;
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: (err as Error).message }));
      return false;
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function saveAll() {
    setMsg(null);
    let ok = 0;
    for (const id of dirtyIds) if (await saveRow(id)) ok++;
    setMsg(`Saved ${ok} of ${dirtyIds.length}.`);
    router.refresh();
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const cell = "border border-transparent rounded px-1.5 py-1 w-full bg-transparent hover:border-brand-ink/20 focus:border-brand-ink/50 focus:bg-white";
  const dirty = (id: string, f: keyof Row) => (rows[id]?.[f] !== start[id]?.[f] ? " bg-amber-50 border-amber-300" : "");

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <button
          type="button"
          onClick={saveAll}
          disabled={!dirtyIds.length || saving.size > 0}
          className="text-sm px-4 py-2 rounded font-medium bg-brand-ink text-white disabled:opacity-40"
        >
          {saving.size ? "Saving…" : `Save all changes (${dirtyIds.length})`}
        </button>
        {dirtyIds.length > 0 && (
          <button type="button" onClick={() => setRows(start)} className="text-sm underline text-brand-ink/60">
            Undo unsaved changes
          </button>
        )}
        {msg && <span className="text-sm text-brand-ink/70">{msg}</span>}
        <span className="text-xs text-brand-ink/50 ml-auto">Grey weight with * = assumed by the writer; type one to set it.</span>
      </div>
      <div className="mb-3">
        <ApproveControl drafts={drafts} picked={picked} onDone={() => setPicked(new Set())} />
      </div>
      <div className="mb-4">
        <MinPriceControl selected={Array.from(picked).filter((id) => editableIds.includes(id))} shown={editableIds} />
      </div>
      <div className="mb-4">
        <ShelfControl selected={Array.from(picked).filter((id) => editableIds.includes(id))} shown={editableIds} shelves={shelves} />
      </div>

      <div className="overflow-x-auto bg-white border border-brand-ink/10 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-brand-ink/60 border-b border-brand-ink/10">
              <th className="p-2">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={pickableIds.length > 0 && pickableIds.every((id) => picked.has(id))}
                  onChange={(e) => setPicked(e.target.checked ? new Set(pickableIds) : new Set())}
                />
              </th>
              <th className="p-2"></th>
              <th className="p-2 min-w-[24rem]">Title</th>
              <th className="p-2">Price</th>
              <th className="p-2">Bin / SKU</th>
              <th className="p-2" title="* = assumed by the writer">Weight oz*</th>
              <th className="p-2 min-w-[16rem]">Store shelves</th>
              <th className="p-2">Shipping</th>
              <th className="p-2">Qty</th>
              <th className="p-2">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => {
              const r = rows[d.id];
              const ed = EDITABLE.has(d.status);
              const n = changed(d.id).length;
              return (
                <tr key={d.id} className="border-t border-brand-ink/5 align-top">
                  <td className="p-2">
                    {(ed || d.status === "approved") && <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} />}
                  </td>
                  <td className="p-2 w-14 min-w-[3.5rem]">
                    {/* Fixed size: the site's global img max-width:100% let the
                        table squeeze this column to a sliver. */}
                    <Link href={`/admin/listings/${d.id}`} className="block w-12 h-12" title="Open the draft">
                      {d.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={d.cover}
                          alt=""
                          loading="lazy"
                          style={{ width: 48, height: 48, maxWidth: "none" }}
                          className="block object-cover rounded border border-brand-ink/10"
                        />
                      ) : (
                        <span className="block w-12 h-12 rounded bg-brand-ink/5" />
                      )}
                    </Link>
                  </td>
                  <td className="p-1">
                    {ed ? (
                      <textarea
                        value={r.title}
                        onChange={set(d.id, "title")}
                        maxLength={80}
                        rows={2}
                        placeholder={d.titleHint ?? ""}
                        className={cell + " resize-none leading-snug" + dirty(d.id, "title")}
                      />
                    ) : (
                      <span className="block px-1.5 py-1">{d.title ?? d.titleHint ?? "Untitled"}</span>
                    )}
                    <span className="block px-1.5 text-[10px] text-brand-ink/40">
                      {r.title.length}/80
                      {d.confidence != null && <> · {Math.round(d.confidence * 100)}%</>}
                      {d.tier && <> · {d.tier}</>}
                    </span>
                  </td>
                  <td className="p-1 min-w-[6rem]">
                    <input value={r.price} onChange={set(d.id, "price")} disabled={!ed} inputMode="decimal" className={cell + " text-right" + dirty(d.id, "price")} />
                    {d.poshmarkPrice != null && <span className="block px-1.5 text-[10px] text-brand-ink/40">Poshmark ${d.poshmarkPrice}</span>}
                  </td>
                  <td className="p-1 min-w-[8rem]">
                    <input value={r.binSku} onChange={set(d.id, "binSku")} disabled={!ed} className={cell + " font-mono" + dirty(d.id, "binSku")} />
                  </td>
                  <td className="p-1 min-w-[5rem]">
                    <input
                      value={r.weightOz}
                      onChange={set(d.id, "weightOz")}
                      disabled={!ed}
                      inputMode="decimal"
                      placeholder={d.assumedWeightOz != null ? `${d.assumedWeightOz}*` : ""}
                      title={d.assumedWeightOz != null && !r.weightOz ? "* assumed by the writer — type a weight to set it" : undefined}
                      className={cell + dirty(d.id, "weightOz")}
                    />
                  </td>
                  <td className="p-1">
                    {(["shelf1", "shelf2"] as const).map((f, k) => (
                      <select
                        key={f}
                        value={r[f]}
                        onChange={set(d.id, f)}
                        disabled={!ed}
                        title={shelfPath.get(r[f]) ?? ""}
                        className={cell + " text-xs" + (k ? " mt-1" : "") + dirty(d.id, f)}
                      >
                        <option value="">{k ? "— second shelf —" : "— first shelf —"}</option>
                        {r[f] && !shelfPath.has(r[f]) && <option value={r[f]}>{r[f]} (not in store list)</option>}
                        {shelves.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.path}
                          </option>
                        ))}
                      </select>
                    ))}
                  </td>
                  <td className="p-1 w-32">
                    <select value={r.shippingProfile} onChange={set(d.id, "shippingProfile")} disabled={!ed} className={cell + dirty(d.id, "shippingProfile")}>
                      <option value="">—</option>
                      <option value="envelope">Envelope</option>
                      <option value="calculated">Calculated</option>
                      <option value="media">Media Mail</option>
                    </select>
                  </td>
                  <td className="p-1 w-14">
                    <input value={r.quantity} onChange={set(d.id, "quantity")} disabled={!ed} inputMode="numeric" className={cell + dirty(d.id, "quantity")} />
                  </td>
                  <td className="p-2 text-xs whitespace-nowrap text-brand-ink/70">{STATUS_LABEL[d.status] ?? d.status}</td>
                  <td className="p-2 whitespace-nowrap">
                    {n > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (await saveRow(d.id)) router.refresh();
                        }}
                        disabled={saving.has(d.id)}
                        className="text-xs px-2 py-1 rounded bg-brand-ink text-white disabled:opacity-40"
                      >
                        {saving.has(d.id) ? "…" : "Save"}
                      </button>
                    )}
                    {errors[d.id] && <span className="block text-xs text-red-800 max-w-[10rem]">{errors[d.id]}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {drafts.length === 0 && <p className="text-sm text-brand-ink/60 mt-4">Nothing here yet.</p>}
    </>
  );
}
