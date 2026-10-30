"use client";

// Shown on a whole-folder lot (Scans page "Send as one lot"): one photo per
// piece, numbered in the order scanned. Photo 1 is the numbered overview;
// with more than 23 pieces, neighbouring pieces share merged photos (fit to
// 24, lib/listings/photo-fit-plan.ts). Pick pieces that keep their own
// photo, switch merging off, or rebuild the overview after turning a photo
// (lib/listings/folder-lot.ts).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoFitBox } from "./PhotoFitBox";

const SLOTS = 23;
const PER_TILE = 4;
/** Mirror of maxPicks() in folder-lot.ts. */
function maxPicks(n: number) {
  if (n <= SLOTS) return n;
  return Math.max(0, Math.min(SLOTS - 1, Math.floor((SLOTS * PER_TILE - n) / (PER_TILE - 1))));
}

export function FolderLotPanel({
  id,
  pieces,
  picked,
  text,
  dropped,
  soloOnly,
  error,
  pending,
  canEdit,
}: {
  id: string;
  pieces: number;
  picked: number[];
  text: string;
  dropped: number[];
  soloOnly: boolean;
  error: string | null;
  pending: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pick, setPick] = useState<number[]>(picked);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const laidOut = pieces > 0;
  const crowded = pieces > SLOTS;
  const max = maxPicks(pieces);
  const changed = pick.length !== picked.length || pick.some((n, i) => n !== picked[i]);

  async function arrange(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/listings/${id}/lot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "arrange", ...body }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      setMsg(done);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(n: number) {
    setPick((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length >= max ? p : [...p, n]));
  }

  const btn = "rounded border border-purple-700 px-3 py-1.5 text-purple-900 hover:bg-purple-100 disabled:opacity-50";
  return (
    <div className="mb-6 rounded-lg border-2 border-purple-700 bg-purple-50 p-4 text-sm">
      <p className="font-bold text-purple-900">
        <span className="mr-2 rounded bg-purple-700 px-1.5 py-0.5 text-white">LOT{laidOut ? ` of ${pieces}` : ""}</span>
        Sent from the Scans page as one folder — one photo per piece.
      </p>
      {!laidOut ? (
        <>
          <p className="mt-2 text-purple-900/80">
            {error
              ? `Laying out the lot's photos didn't work: ${error}`
              : pending
                ? "The lot's photos are laid out once every photo has arrived."
                : "These photos haven't been laid out as a lot yet."}
          </p>
          {canEdit && (
            <button type="button" disabled={busy} className={`${btn} mt-3`} onClick={() => arrange({ rebuild: true }, "Laid out.")}>
              {busy ? "Laying out…" : "Lay out the lot"}
            </button>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-purple-900/80">Photo 1 is a numbered overview of all {pieces}.</p>
          <PhotoFitBox id={id} soloOnly={soloOnly} text={text} dropped={dropped} error={null} canEdit={canEdit} />
          {canEdit && crowded && !soloOnly && max > 0 && (
            <div className="mt-3">
              <p className="text-purple-900/80">
                Keep their own photo ({pick.length} of up to {max}) — click pieces by their overview number; the rest are merged with their neighbours:
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {Array.from({ length: pieces }, (_, i) => i + 1).map((n) => {
                  const on = pick.includes(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggle(n)}
                      disabled={busy || (!on && pick.length >= max)}
                      className={`w-9 rounded border px-1 py-1 font-mono text-xs ${on ? "border-purple-700 bg-purple-700 text-white" : "border-purple-300 bg-white text-purple-900"} disabled:opacity-40`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-3">
              {crowded && !soloOnly && (
                <button type="button" disabled={busy || !changed} className={btn} onClick={() => arrange({ solo: pick }, "Photos rearranged.")}>
                  {busy ? "Working…" : "Save photo choice"}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                className={btn}
                title="Redraw the numbered overview (and merged photos), e.g. after turning a photo"
                onClick={() => arrange({ solo: pick, rebuild: true }, "Overview rebuilt.")}
              >
                {busy ? "Working…" : "Rebuild overview"}
              </button>
            </div>
          )}
        </>
      )}
      {msg && <p className={`mt-2 ${/^(Photos|Overview|Laid)/.test(msg) ? "text-green-800" : "text-red-800"}`}>{msg}</p>}
    </div>
  );
}
