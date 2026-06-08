"use client";

// Client button used on product pages when "See similar items" couldn't
// be resolved at server-render time (i.e., no cached category and no
// matching eBay listing). Calling /api/products/[slug]/similar runs the
// Haiku fallback and returns the eBay store URL; we navigate there.
//
// Once the category is resolved, the cache column on the item gets set,
// so the next page render skips this button entirely.

import { useState } from "react";

export default function SeeSimilarButton({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(slug)}/similar`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { url: string };
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't find a match.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center px-4 py-2 bg-transparent text-brand-ink border border-brand-ink/30 text-sm font-medium rounded-md hover:bg-brand-ink/5 transition-colors disabled:opacity-50"
      >
        {busy ? "Finding similar items…" : "See similar items →"}
      </button>
      {error && (
        <p className="text-xs text-brand-ink/60 italic mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
