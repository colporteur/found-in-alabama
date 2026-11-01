"use client";

// "Add photos" on a draft: pick or drop photos (any device), they're added
// after the draft's last photo in file-name order (10312026.jpg, _001, _002…).
// Drafts Claude created from a chat arrive with none, and can't be approved
// until they have one (lib/listings/intake.ts addDraftPhotos).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { downsize, sha256 } from "../photoPrep";

export function AddPhotos({ id, have, needed, note }: { id: string; have: number; needed: boolean; note: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const room = Math.max(0, 24 - have);

  async function add(list: FileList | File[] | null) {
    const files = Array.from(list ?? [])
      .filter((f) => /^image\//.test(f.type))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.length) return;
    if (files.length > room) {
      setMsg(`eBay takes 24 photos; this draft has room for ${room} more.`);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const prepared: { blob: Blob; sha: string; name: string }[] = [];
      for (const [i, f] of files.entries()) {
        setMsg(`Preparing photo ${i + 1} of ${files.length}…`);
        const blob = await downsize(f);
        prepared.push({ blob, sha: await sha256(blob), name: f.name });
      }
      const res = await fetch(`/api/admin/listings/${id}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: prepared.map((p) => ({ name: p.name, sha256: p.sha, bytes: p.blob.size, contentType: "image/jpeg" })) }),
      });
      const out = (await res.json().catch(() => ({}))) as { uploads?: { position: number; url: string; name: string }[]; error?: string };
      if (!res.ok || !out.uploads) throw new Error(out.error ?? `HTTP ${res.status}`);
      // Match each upload slot to its file by name (slots come back in position order).
      const byName = new Map(prepared.map((p) => [p.name.slice(0, 200), p]));
      for (const [i, u] of out.uploads.entries()) {
        const p = byName.get(u.name) ?? prepared[i];
        if (!p) continue;
        setMsg(`Uploading photo ${i + 1} of ${out.uploads.length}…`);
        const r = await fetch(u.url, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: p.blob });
        if (!r.ok) throw new Error(`Photo ${u.position}: HTTP ${r.status}`);
      }
      await fetch(`/api/admin/listings/${id}/complete`, { method: "POST" });
      setMsg(`Added ${prepared.length} photo${prepared.length === 1 ? "" : "s"}.`);
      router.refresh();
    } catch (err) {
      setMsg(`Failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy) add(e.dataTransfer.files);
      }}
      className={`mb-6 rounded-lg border-2 border-dashed p-4 text-sm ${needed ? "border-amber-600 bg-amber-50" : "border-brand-ink/20"} ${over ? "bg-amber-100" : ""}`}
    >
      {needed && (
        <p className="font-bold text-amber-900">
          <span className="mr-2 rounded bg-amber-700 px-1.5 py-0.5 text-white">CREATED BY CLAUDE</span>
          No photos yet — add them here. It can&rsquo;t be approved without one.
        </p>
      )}
      {note && <p className="mt-1 text-amber-900/80">Photos to add: {note}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className={`cursor-pointer rounded border border-brand-ink/40 px-3 py-1.5 hover:bg-brand-ink/5 ${busy || !room ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? "Working…" : "Add photos"}
          <input type="file" accept="image/*" multiple className="hidden" disabled={busy || !room} onChange={(e) => add(e.target.files)} />
        </label>
        <span className="text-brand-ink/60">or drop them here — added in file-name order after photo {have}. Room for {room} more.</span>
      </div>
      {msg && <p className={`mt-2 ${/^(Added|Preparing|Uploading)/.test(msg) ? "text-green-800" : "text-red-800"}`}>{msg}</p>}
    </div>
  );
}
