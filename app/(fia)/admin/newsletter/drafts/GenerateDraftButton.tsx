"use client";

// Single-button form that POSTs to /generate and bounces to the editor
// on success. Default window = 30 days (the API's default).

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GenerateDraftButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/newsletter/draft/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      router.push(`/admin/newsletter/drafts/${data.draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center px-5 py-3 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors disabled:opacity-50"
      >
        {busy ? "Generating… (10–20s)" : "Generate new draft →"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-700">{error}</p>
      )}
      <p className="mt-2 text-xs text-brand-ink/55">
        Pulls the last 30 days of hauls, your active items, and your sales,
        then asks Claude to draft both flavors of the newsletter. ~$0.03 per
        generation.
      </p>
    </div>
  );
}
