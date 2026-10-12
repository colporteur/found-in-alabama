"use client";

// The draft's photos with ↺ / ↻ buttons. Turning a photo saves a rotated
// copy (the first upload is kept), so the writer, Claude, Nifty and every
// venue get it the right way up. "Make a cover" tiles the ticked photos into
// one square collage (lib/listings/cover.ts) and makes it photo 1.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftPhoto } from "@/lib/listings/drafts";

export function PhotoStrip({ id, photos, canRotate }: { id: string; photos: DraftPhoto[]; canRotate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [making, setMaking] = useState(false);
  const isOurCover = (p: DraftPhoto) => p.role === "cover" && /\/cover\//.test(p.url);

  function startCover() {
    // Start from the fronts (the usual lot cover); Todd changes the ticks.
    const fronts = photos.filter((p) => p.uploaded && p.role === "front").map((p) => p.position);
    setTicked(new Set(fronts.length ? fronts : photos.filter((p) => p.uploaded && !isOurCover(p)).map((p) => p.position)));
    setPicking(true);
    setMsg(null);
  }

  async function makeCover() {
    setMaking(true);
    setMsg(null);
    try {
      const positions = photos.map((p) => p.position).filter((n) => ticked.has(n));
      const res = await fetch(`/api/admin/listings/${id}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      setPicking(false);
      setMsg(`Cover made from ${out.tiles} photo${out.tiles === 1 ? "" : "s"} — it's photo 1 now.`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setMaking(false);
    }
  }

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
      {canRotate && photos.some((p) => p.uploaded) && (
        <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
          {!picking ? (
            <button type="button" onClick={startCover} className="px-3 py-1.5 rounded border border-brand-ink/20 hover:border-brand-ink/50">
              {photos.some(isOurCover) ? "Make a new cover…" : "Make a cover…"}
            </button>
          ) : (
            <>
              <span className="text-brand-ink/70">Tick the photos for the cover (fronts are ticked to start).</span>
              <button
                type="button"
                onClick={makeCover}
                disabled={making || !ticked.size}
                className="px-3 py-1.5 rounded bg-brand-ink text-white disabled:opacity-40"
              >
                {making ? "Making cover…" : `Make cover from ${ticked.size} photo${ticked.size === 1 ? "" : "s"}`}
              </button>
              <button type="button" onClick={() => setPicking(false)} className="underline text-brand-ink/60">
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {photos.map((p) => (
          <figure key={p.position} className="shrink-0 w-48">
            <div className="w-48 h-48 bg-brand-ink/5 rounded border border-brand-ink/10 flex items-center justify-center overflow-hidden relative">
              {picking && p.uploaded && !isOurCover(p) && (
                <label className="absolute top-1 left-1 z-10 bg-white/90 rounded px-1.5 py-1 flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={ticked.has(p.position)}
                    onChange={() =>
                      setTicked((t) => {
                        const n = new Set(t);
                        if (n.has(p.position)) n.delete(p.position);
                        else n.add(p.position);
                        return n;
                      })
                    }
                  />
                  cover
                </label>
              )}
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
      {msg && <p className={`text-sm ${msg.startsWith("Cover made") ? "text-green-800" : "text-red-800"}`}>{msg}</p>}
    </div>
  );
}
