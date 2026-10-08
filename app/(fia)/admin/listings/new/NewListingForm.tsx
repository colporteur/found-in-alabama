"use client";

// Manual lister form: pick photos, order them, add what's known, create the
// draft, upload each photo through the app, confirm, open the draft.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Pic = { id: string; file: File; preview: string; role: string };

const MAX_EDGE = 3200;
const ROLES = ["", "front", "back", "cover", "inside", "detail"];

async function downsize(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  // Stay under the app's 4.5 MB request limit: step the quality down if needed.
  for (const q of [0.9, 0.82, 0.72, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
    if (!blob) throw new Error(`Couldn't read ${file.name}`);
    if (blob.size < 4_000_000) return blob;
  }
  throw new Error(`${file.name} is too large even after resizing`);
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function NewListingForm() {
  const router = useRouter();
  const [pics, setPics] = useState<Pic[]>([]);
  const [titleHint, setTitleHint] = useState("");
  const [notes, setNotes] = useState("");
  const [binSku, setBinSku] = useState("");
  const [weightOz, setWeightOz] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [mode, setMode] = useState<"ai" | "hand">("ai");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function add(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), role: "" }));
    setPics((p) => [...p, ...next].slice(0, 24));
  }
  function move(i: number, d: -1 | 1) {
    setPics((p) => {
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const c = [...p];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  }

  async function submit() {
    if (pics.length === 0) return setMsg("Add at least one photo.");
    setBusy(true);
    setMsg("Preparing photos…");
    try {
      const prepared = [];
      for (const p of pics) {
        const blob = await downsize(p.file);
        prepared.push({ blob, sha: await sha256(blob), name: p.file.name, role: p.role || null });
      }
      setMsg("Creating draft…");
      const res = await fetch("/api/admin/listings/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          uploadMode: "proxy",
          titleHint,
          notes,
          binSku,
          weightOz: weightOz || null,
          quantity: quantity || 1,
          facts: { mode },
          photos: prepared.map((p) => ({
            name: p.name,
            sha256: p.sha,
            bytes: p.blob.size,
            contentType: "image/jpeg",
            role: p.role,
          })),
        }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        draftId?: string;
        uploads?: { position: number; url: string }[];
        error?: string;
      };
      if (!res.ok || !out.draftId) throw new Error(out.error ?? `HTTP ${res.status}`);
      const uploads = out.uploads ?? [];
      for (let i = 0; i < uploads.length; i++) {
        setMsg(`Uploading photo ${i + 1} of ${uploads.length}…`);
        const u = uploads[i];
        const r = await fetch(u.url, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: prepared[u.position - 1].blob,
        });
        if (!r.ok) throw new Error(`Photo ${u.position}: HTTP ${r.status}`);
      }
      await fetch(`/api/admin/listings/${out.draftId}/complete`, { method: "POST" });
      router.push(`/admin/listings/${out.draftId}`);
    } catch (err) {
      setMsg(`Failed: ${(err as Error).message}`);
      setBusy(false);
    }
  }

  const input = "w-full border border-brand-ink/20 rounded px-2 py-1 text-sm";
  const label = "block text-xs uppercase tracking-wider text-brand-ink/50 mb-1";

  return (
    <div className="space-y-6">
      <div>
        <label className="inline-block text-sm px-4 py-2 rounded border border-brand-ink/30 cursor-pointer hover:border-brand-ink/60">
          Add photos
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => add(e.target.files)} />
        </label>
        <span className="text-xs text-brand-ink/50 ml-3">{pics.length}/24 · first photo is the main one</span>
        <div className="flex flex-wrap gap-3 mt-4">
          {pics.map((p, i) => (
            <div key={p.id} className="w-36 border border-brand-ink/15 rounded p-2 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="w-full h-28 object-contain bg-brand-ink/5" />
              <select
                className="w-full text-xs mt-1 border border-brand-ink/20 rounded"
                value={p.role}
                onChange={(e) => setPics((ps) => ps.map((x) => (x.id === p.id ? { ...x, role: e.target.value } : x)))}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r || "(role)"}
                  </option>
                ))}
              </select>
              <div className="flex justify-between text-xs mt-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}>
                  ←
                </button>
                <button type="button" onClick={() => setPics((ps) => ps.filter((x) => x.id !== p.id))} className="text-red-800">
                  remove
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === pics.length - 1}>
                  →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label}>What is it? (a rough title is fine)</label>
          <input className={input} value={titleHint} onChange={(e) => setTitleHint(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Notes for the writer — condition, age, story, anything you know</label>
          <textarea className={`${input} h-28`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div>
          <label className={label}>Bin (SKU)</label>
          <input className={input} value={binSku} onChange={(e) => setBinSku(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Weight (oz)</label>
            <input className={input} inputMode="decimal" value={weightOz} onChange={(e) => setWeightOz(e.target.value)} />
          </div>
          <div>
            <label className={label}>Quantity</label>
            <input className={input} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>
      </div>

      <fieldset className="text-sm space-y-1">
        <label className="flex gap-2 items-center">
          <input type="radio" checked={mode === "ai"} onChange={() => setMode("ai")} /> Let the writer fill in the listing
        </label>
        <label className="flex gap-2 items-center">
          <input type="radio" checked={mode === "hand"} onChange={() => setMode("hand")} /> I&apos;ll write it myself
        </label>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="text-sm px-4 py-2 rounded font-medium bg-brand-ink text-white hover:bg-brand-ink/80 disabled:opacity-50"
        >
          {busy ? "Working…" : "Create draft"}
        </button>
        {msg && <span className="text-sm text-brand-ink/70">{msg}</span>}
      </div>
    </div>
  );
}
