"use client";

// Shown on a whole-folder lot (Scans page "Send as one lot"): one photo per
// piece, numbered in the order scanned. Photo 1 is the numbered overview;
// with more than 23 pieces, 22 get their own photo and the rest share the
// "Also included" grid. Tick which pieces get their own photo, or rebuild
// the overview after turning a photo (lib/listings/folder-lot.ts).

import { useState } from "react";
import { useRouter } from "next/navigation";

const SOLO_SLOTS = 22;

export function FolderLotPanel({
  id,
  pieces,
  solo,
  error,
  pending,
  canEdit,
}: {
  id: string;
  pieces: number;
  solo: number[];
  error: string | null;
  pending: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pick, setPick] = useState<number[]>(solo);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const laidOut = pieces > 0;
  const crowded = pieces > SOLO_SLOTS + 1;
  const grid = laidOut ? Array.from({ length: pieces }, (_, i) => i + 1).filter((n) => !solo.includes(n)) : [];
  const changed = pick.length !== solo.length || pick.some((n, i) => n !== solo[i]);

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
    setPick((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length >= SOLO_SLOTS ? p : [...p, n]));
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
          <p className="mt-2 text-purple-900/80">
            Photo 1 is a numbered overview of all {pieces}.{" "}
            {crowded ? (
              <>
                Pieces {solo.map((n) => `#${n}`).join(", ")} have their own photo; {grid.map((n) => `#${n}`).join(", ")} share the
                &ldquo;Also included&rdquo; grid (photo {solo.length + 2}) — that makes eBay&rsquo;s 24. Their full-size photos are kept on the
                draft after it but aren&rsquo;t listed.
              </>
            ) : (
              <>Every piece has its own photo after it.</>
            )}
          </p>
          {canEdit && crowded && (
            <div className="mt-3">
              <p className="text-purple-900/80">
                Own photo ({pick.length} of {SOLO_SLOTS}) — click to swap a piece in or out (numbers are on the overview):
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {Array.from({ length: pieces }, (_, i) => i + 1).map((n) => {
                  const on = pick.includes(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggle(n)}
                      disabled={busy || (!on && pick.length >= SOLO_SLOTS)}
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
              {crowded && (
                <button type="button" disabled={busy || !changed} className={btn} onClick={() => arrange({ solo: pick }, "Photos rearranged.")}>
                  {busy ? "Working…" : "Save photo choice"}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                className={btn}
                title="Redraw the numbered overview (and grid), e.g. after turning a photo"
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
