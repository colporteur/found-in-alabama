"use client";

// The draft's photos with ↺ / ↻ buttons. Turning a photo saves a rotated
// copy (the first upload is kept), so the writer, Claude, Nifty and every
// venue get it the right way up.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftPhoto } from "@/lib/listings/drafts";

export function PhotoStrip({ id, photos, canRotate }: { id: string; photos: DraftPhoto[]; canRotate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function turn(position: number, delta: 90 | -90) {
    setBusy(position);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/listings/${id}/photo/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position, delta }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const btn = "text-base leading-none px-2 py-1 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-40";
  return (
    <div className="mb-8">
      <div className="flex gap-3 overflow-x-auto pb-3">
        {photos.map((p) => (
          <figure key={p.position} className="shrink-0 w-48">
            <div className="w-48 h-48 bg-brand-ink/5 rounded border border-brand-ink/10 flex items-center justify-center overflow-hidden relative">
              {p.uploaded ? (
                <a href={p.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className={`object-contain max-w-full max-h-48 ${busy === p.position ? "opacity-40" : ""}`} />
                </a>
              ) : (
                <span className="text-xs text-brand-ink/40">not uploaded yet</span>
              )}
            </div>
            <figcaption className="text-xs text-brand-ink/60 mt-1 flex items-center gap-1">
              <span className="truncate flex-1">
                {p.position}. {p.role ?? ""} {p.name ?? ""}
                {p.rotation ? ` · turned ${p.rotation}°` : ""}
              </span>
              {canRotate && p.uploaded && (
                <>
                  <button type="button" title="Turn left" aria-label="Turn left" onClick={() => turn(p.position, -90)} disabled={busy !== null} className={btn}>
                    ↺
                  </button>
                  <button type="button" title="Turn right" aria-label="Turn right" onClick={() => turn(p.position, 90)} disabled={busy !== null} className={btn}>
                    ↻
                  </button>
                </>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      {msg && <p className="text-sm text-red-800">{msg}</p>}
    </div>
  );
}
