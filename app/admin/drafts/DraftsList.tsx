"use client";

import { useState } from "react";
import Link from "next/link";

export type DraftSummary = {
  id: string;
  label: string;
  heroCount: number;
  contextCount: number;
  hasNarrative: boolean;
  title: string | null;
  acquisitionContext: string;
  previewSrc: string | null;
  updatedAt: string;
};

export default function DraftsList({
  drafts: initial,
}: {
  drafts: DraftSummary[];
}) {
  const [drafts, setDrafts] = useState(initial);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: string, displayName: string) {
    if (!confirm(`Delete the draft "${displayName}"? This can't be undone.`)) {
      return;
    }
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/haul-drafts/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDrafts((cur) => cur.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Saved
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">Haul drafts</h1>
        </div>
        <div className="flex gap-4 text-sm">
          <Link
            href="/admin/draft"
            className="hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
          >
            ← Draft new
          </Link>
          <Link
            href="/admin"
            className="text-brand-ink/60 hover:text-brand-ink"
          >
            Dashboard
          </Link>
        </div>
      </div>

      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Drafts you&rsquo;ve saved to come back to later. Click <strong>Open</strong>{" "}
        to keep editing — add more photo notes, run Claude, refine the narrative,
        or publish. Drafts get deleted automatically when you publish them.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6 text-sm text-red-900">
          {error}
        </div>
      )}

      {drafts.length === 0 ? (
        <p className="text-sm text-brand-ink/60 italic">
          No saved drafts.{" "}
          <Link
            href="/admin/draft"
            className="underline decoration-brand-yellow decoration-2 underline-offset-2"
          >
            Draft one →
          </Link>
        </p>
      ) : (
        <div className="border border-brand-ink/15 rounded-lg bg-white overflow-hidden divide-y divide-brand-ink/10">
          {drafts.map((d) => {
            const displayName =
              d.label.trim() || d.title?.trim() || "(unlabeled draft)";
            const updated = new Date(d.updatedAt);
            const photoSummary = `${d.heroCount} haul + ${d.contextCount} context photo${
              d.heroCount + d.contextCount === 1 ? "" : "s"
            }`;
            return (
              <div
                key={d.id}
                className="flex items-start gap-4 p-4 hover:bg-brand-paper/50 transition-colors"
              >
                {d.previewSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={d.previewSrc}
                    alt=""
                    className="w-16 h-16 object-cover rounded shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 bg-brand-paper rounded shrink-0 flex items-center justify-center text-brand-ink/30 text-xs">
                    no photo
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{displayName}</p>
                  <p className="text-xs text-brand-ink/55 mt-0.5">
                    Last edited {updated.toLocaleString()} · {photoSummary}
                    {d.hasNarrative ? (
                      <span className="ml-2 text-brand-earth uppercase tracking-wider">
                        · narrative
                      </span>
                    ) : (
                      <span className="ml-2 text-brand-ink/40 uppercase tracking-wider">
                        · inputs only
                      </span>
                    )}
                  </p>
                  {d.acquisitionContext && (
                    <p className="text-xs text-brand-ink/60 mt-1 line-clamp-2">
                      {d.acquisitionContext.slice(0, 180)}
                      {d.acquisitionContext.length > 180 ? "…" : ""}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link
                    href={`/admin/draft?id=${d.id}`}
                    className="text-xs px-3 py-1.5 bg-brand-yellow text-brand-ink font-medium rounded hover:bg-brand-yellow-dark transition-colors"
                  >
                    Open
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(d.id, displayName)}
                    disabled={deletingId === d.id}
                    className="text-xs px-3 py-1.5 border border-brand-ink/20 rounded hover:bg-red-50 hover:border-red-200 hover:text-red-900 transition-colors disabled:opacity-50"
                  >
                    {deletingId === d.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
