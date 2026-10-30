"use client";

// "Fit to 24" on a lot's draft page (lib/listings/photo-fit.ts): where the
// pieces are in the listed photos, the "solo photos only" switch (no merged
// photos — fronts first, then backs, as many as fit), and a re-fit button.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PhotoFitBox({
  id,
  soloOnly,
  text,
  dropped,
  error,
  canEdit,
}: {
  id: string;
  soloOnly: boolean;
  /** "photo 2: #1; photo 3: #2 + #3 (merged, 4 scans); …" — empty when everything fits. */
  text: string;
  dropped: number[];
  error: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function fit(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/listings/${id}/lot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "photo_fit", ...body }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const merged = /merged/.test(text);
  return (
    <div className="mt-3 rounded border border-purple-300 bg-white/70 p-3 text-purple-900">
      <p className="font-semibold">Photos (eBay allows 24)</p>
      {text ? (
        <p className="mt-1 text-purple-900/80">
          {soloOnly
            ? "Solo photos only: every front first, then backs, as many as fit. Scans that didn't fit wait on the draft after photo 24."
            : merged
              ? "More scans than fit, so some share a merged photo, numbered like the cover. Their full-size scans wait on the draft after photo 24."
              : "Every scan has its own photo."}{" "}
          <span className="text-xs">{text}.</span>
        </p>
      ) : (
        <p className="mt-1 text-purple-900/80">Every scan fits with its own photo.</p>
      )}
      {dropped.length > 0 && (
        <p className="mt-1 text-purple-900/80">
          Pieces {dropped.map((n) => `#${n}`).join(", ")} are only on the cover — there&rsquo;s no room for them in the 24.
        </p>
      )}
      {error && <p className="mt-1 text-red-800">Merged photos couldn&rsquo;t be made ({error}), so this fell back to solo photos. Try &ldquo;Re-fit photos&rdquo;.</p>}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={soloOnly} disabled={busy} onChange={(e) => fit({ soloOnly: e.target.checked })} />
            Solo photos only (no merged photos)
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => fit({})}
            title="Lay the photos out again, e.g. after turning a photo"
            className="rounded border border-purple-700 px-3 py-1 hover:bg-purple-100 disabled:opacity-50"
          >
            {busy ? "Working…" : "Re-fit photos"}
          </button>
        </div>
      )}
      {msg && <p className="mt-1 text-red-800">{msg}</p>}
    </div>
  );
}
