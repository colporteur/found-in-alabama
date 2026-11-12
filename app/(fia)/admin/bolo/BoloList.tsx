"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoloCategory, BoloItem } from "@/lib/bolo/discontinued";

export type BoloRow = Omit<BoloItem, "img"> & {
  added: boolean;
  addedAt: string | null;
  thumb: string | null;
  liveCount: number | null;
  liveMedian: number | null;
  soldUrl: string;
  liveUrl: string;
};

const CATS: Array<BoloCategory | "All"> = [
  "All",
  "Cleaners & polish",
  "Air fresheners",
  "Bar soap",
  "Hair care",
  "Fragrance",
  "Other",
  "Traps",
];

const KIND_STYLE: Record<BoloRow["kind"], string> = {
  sold: "bg-green-100 text-green-800",
  asking: "bg-amber-100 text-amber-800",
  retail: "bg-red-100 text-red-800",
};
const KIND_LABEL: Record<BoloRow["kind"], string> = { sold: "Sold", asking: "Asking", retail: "Retail" };

/** Downsize on the phone before upload: keeps the request well under the
 *  4.5 MB serverless limit and makes the upload quick on one bar of signal. */
async function shrink(file: File, maxEdge = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (blob) return blob;
  } catch {
    // Browser can't decode it (e.g. HEIC on desktop) — send the original.
  }
  return file;
}

function AddFromPhoto({ onAdded }: { onAdded: (name: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(f: File | null) {
    setError(null);
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await shrink(file);
      if (blob.size > 4_000_000) throw new Error("That photo is too large to send. Try a smaller one.");
      const fd = new FormData();
      fd.append("photo", blob, "bolo.jpg");
      if (hint.trim()) fd.append("hint", hint.trim());
      const res = await fetch("/api/admin/bolo", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { error?: string; item?: { name: string } };
      if (!res.ok || !j.item) throw new Error(j.error || `Upload failed (${res.status})`);
      onAdded(j.item.name);
      pick(null);
      setHint("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-3 mb-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      <div className="flex gap-3 items-start">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="shrink-0 w-20 h-20 rounded border-2 border-dashed border-brand-ink/25 bg-brand-paper flex items-center justify-center text-xs text-brand-ink/60 text-center overflow-hidden"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="w-full h-full object-cover" />
          ) : (
            <span>Take or pick a photo</span>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            disabled={busy}
            placeholder="Note (optional): price, store"
            className="w-full border border-brand-ink/20 rounded px-3 py-2 text-base mb-2"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!file || busy}
            className="w-full rounded bg-brand-ink text-white py-2 text-sm disabled:opacity-40"
          >
            {busy ? "Looking it up… (up to a minute)" : "Identify & add to list"}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
      <p className="text-xs text-brand-ink/50 mt-2">
        AI reads the label, checks whether it&apos;s discontinued and looks up eBay prices. Still in stores? It lands
        under Traps.
      </p>
    </div>
  );
}

export default function BoloList({ rows, canAdd }: { rows: BoloRow[]; canAdd: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<BoloCategory | "All">("All");
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      if (cat !== "All" && r.category !== cat) return false;
      if (cat === "All" && r.category === "Traps" && !words.length && !r.added) return false;
      const hay = `${r.name} ${r.note ?? ""} ${r.query} ${r.category}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, q, cat]);

  async function remove(r: BoloRow) {
    if (!r.added) return;
    setRemoving(r.id);
    try {
      const res = await fetch("/api/admin/bolo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hide", id: r.id }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Remove failed");
      router.refresh();
    } catch (err) {
      setFlash((err as Error).message);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div>
      {canAdd ? (
        <>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="w-full mb-3 rounded-lg border border-brand-ink bg-brand-yellow/80 py-2.5 font-medium"
          >
            {adding ? "Close" : "＋ Add from photo"}
          </button>
          {adding && (
            <AddFromPhoto
              onAdded={(name) => {
                setFlash(`Added: ${name}`);
                setQ("");
                setCat("All");
                router.refresh();
              }}
            />
          )}
        </>
      ) : (
        <p className="text-sm text-brand-ink/60 mb-3">
          Adding from a photo needs the database migration (<code>npm run db:migrate</code>).
        </p>
      )}
      {flash && (
        <p className="text-sm bg-green-50 border border-green-200 text-green-900 rounded px-3 py-2 mb-3" onClick={() => setFlash(null)}>
          {flash}
        </p>
      )}

      <div className="sticky top-0 z-10 bg-brand-paper pb-3 pt-1">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Brand or product — pledge, dial, glade…"
          className="w-full border border-brand-ink/20 rounded-lg px-4 py-3 text-base bg-white mb-3"
          autoComplete="off"
          autoCapitalize="off"
        />
        <div className="flex gap-2 overflow-x-auto pb-1 text-sm -mx-1 px-1">
          {CATS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={`shrink-0 px-3 py-1.5 rounded-full border ${
                c === cat ? "bg-brand-ink text-white border-brand-ink" : "bg-white border-brand-ink/20"
              } ${c === "Traps" && c !== cat ? "text-red-700" : ""}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-brand-ink/50 mb-3">
        {shown.length} of {rows.length}
        {cat === "All" && !q ? " · Traps hidden (tap Traps to see what not to pay up for)" : ""}
      </p>

      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((r) => (
          <li
            key={r.id}
            className={`bg-white border rounded-lg p-3 flex gap-3 ${
              r.category === "Traps" ? "border-red-200" : "border-brand-ink/15"
            }`}
          >
            <a href={r.liveUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
              {r.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.thumb}
                  alt=""
                  loading="lazy"
                  className="w-20 h-20 md:w-24 md:h-24 object-contain rounded bg-brand-paper border border-brand-ink/10"
                />
              ) : (
                <div className="w-20 h-20 md:w-24 md:h-24 rounded bg-brand-paper border border-brand-ink/10 flex items-center justify-center text-xs text-brand-ink/40 text-center p-1">
                  no photo
                </div>
              )}
            </a>
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-snug">
                {r.name}
                {r.added && (
                  <span className="ml-2 align-middle text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                    Yours
                  </span>
                )}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{r.comp}</span>
                <span className={`text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded ${KIND_STYLE[r.kind]}`}>
                  {KIND_LABEL[r.kind]}
                </span>
                {r.added && r.category === "Traps" && <span className="text-xs text-red-700">still in stores</span>}
              </p>
              {r.liveCount != null && (
                <p className="text-xs text-brand-ink/60 mt-1">
                  {r.liveCount.toLocaleString()} live on eBay
                  {r.liveMedian != null ? ` · typical ask $${r.liveMedian.toFixed(2)}` : ""}
                </p>
              )}
              {r.note && <p className="text-sm text-brand-ink/70 mt-1 leading-snug">{r.note}</p>}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <a href={r.soldUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 decoration-brand-yellow decoration-2">
                  Sold comps
                </a>
                <a href={r.liveUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 decoration-brand-yellow decoration-2">
                  Live listings
                </a>
                {r.source && (
                  <a href={r.source} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-brand-ink/60">
                    Source
                  </a>
                )}
                {r.added && (
                  <button
                    type="button"
                    onClick={() => remove(r)}
                    disabled={removing === r.id}
                    className="ml-auto text-brand-ink/50 hover:text-red-700"
                  >
                    {removing === r.id ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!shown.length && <p className="text-sm text-brand-ink/60 mt-6">Nothing on the list matches — not a BOLO (yet).</p>}
    </div>
  );
}
