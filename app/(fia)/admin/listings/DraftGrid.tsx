"use client";

// The listings queue grid (Phase LIST-2): draft cards, checkboxes on drafts
// waiting for review, bulk approve, and "Write all ready", which runs the
// writer on every ready draft two at a time from this page. Nothing here
// publishes.

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftSummary } from "@/lib/listings/drafts";

const STATUS_LABEL: Record<string, string> = {
  uploading: "Uploading photos",
  ready: "Ready to write",
  generating: "Writing",
  review: "To review",
  approved: "Approved",
  in_nifty: "In Nifty (draft)",
  published: "Published",
  sent_back: "Sent back",
  discarded: "Discarded",
};

const SOURCE_LABEL: Record<string, string> = {
  scans: "Scans",
  scanroom: "Scanroom",
  photoxfer: "PhotoXfer",
  estate: "Estate Sorter",
  manual: "Manual",
};

export function DraftGrid({ drafts, readyCount }: { drafts: DraftSummary[]; readyCount: number }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [run, setRun] = useState<{ done: number; failed: number; total: number; spent: number } | null>(null);
  const stop = useRef(false);

  const reviewable = drafts.filter((d) => d.status === "review");
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function approve() {
    setMsg(null);
    const res = await fetch("/api/admin/listings/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", ids: Array.from(picked) }),
    });
    const out = (await res.json().catch(() => ({}))) as { approved?: string[]; skipped?: Array<{ reason: string }>; error?: string };
    if (!res.ok) {
      setMsg(out.error ?? `HTTP ${res.status}`);
      return;
    }
    const skipped = out.skipped ?? [];
    setMsg(`Approved ${out.approved?.length ?? 0}.${skipped.length ? ` Skipped ${skipped.length}: ${skipped.map((s) => s.reason).join("; ")}` : ""}`);
    setPicked(new Set());
    router.refresh();
  }

  async function writeAll() {
    setMsg(null);
    const res = await fetch("/api/admin/listings/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "writable" }),
    });
    const out = (await res.json().catch(() => ({}))) as { ids?: string[]; error?: string };
    const ids = out.ids ?? [];
    if (!res.ok || ids.length === 0) {
      setMsg(out.error ?? "Nothing ready to write.");
      return;
    }
    stop.current = false;
    const state = { done: 0, failed: 0, total: ids.length, spent: 0 };
    setRun({ ...state });
    const queue = [...ids];
    const worker = async () => {
      while (queue.length && !stop.current) {
        const id = queue.shift()!;
        try {
          const r = await fetch(`/api/admin/listings/${id}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tier: "auto" }),
          });
          const o = (await r.json().catch(() => ({}))) as { ok?: boolean; costUsd?: number };
          if (r.ok && o.ok) {
            state.done++;
            state.spent += Number(o.costUsd ?? 0);
          } else state.failed++;
        } catch {
          state.failed++;
        }
        setRun({ ...state });
      }
    };
    await Promise.all([worker(), worker()]);
    setMsg(
      `${stop.current ? "Stopped. " : ""}Wrote ${state.done}${state.failed ? `, ${state.failed} failed (open them to see why)` : ""} · $${state.spent.toFixed(2)}`
    );
    setRun(null);
    router.refresh();
  }

  const btn = "text-sm px-3 py-2 rounded font-medium disabled:opacity-50";

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {readyCount > 0 && !run && (
          <button type="button" onClick={writeAll} className={`${btn} bg-brand-earth text-white hover:bg-brand-earth/80`}>
            Write all ready ({readyCount})
          </button>
        )}
        {run && (
          <>
            <span className="text-sm">
              Writing {run.done + run.failed} of {run.total}… ${run.spent.toFixed(2)} so far
            </span>
            <button type="button" onClick={() => (stop.current = true)} className={`${btn} border border-brand-ink/20`}>
              Stop after current
            </button>
          </>
        )}
        {reviewable.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setPicked(new Set(reviewable.filter((d) => (d.confidence ?? 0) >= 0.8).map((d) => d.id)))}
              className={`${btn} border border-brand-ink/20`}
            >
              Pick confident (≥ 80%)
            </button>
            <button type="button" onClick={() => setPicked(new Set())} className={`${btn} border border-brand-ink/20`} disabled={!picked.size}>
              Clear
            </button>
            <button type="button" onClick={approve} disabled={!picked.size} className={`${btn} bg-green-800 text-white hover:bg-green-700`}>
              Approve selected ({picked.size})
            </button>
          </>
        )}
        {msg && <span className="text-sm text-brand-ink/70">{msg}</span>}
      </div>

      {drafts.length === 0 ? (
        <p className="text-sm text-brand-ink/60">Nothing here yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {drafts.map((d) => (
            <div
              key={d.id}
              className={`relative bg-white border rounded-lg overflow-hidden hover:border-brand-ink/40 ${
                picked.has(d.id) ? "border-green-800 ring-2 ring-green-800/30" : "border-brand-ink/15"
              }`}
            >
              {d.status === "review" && (
                <label className="absolute top-2 left-2 z-10 bg-white/90 rounded px-1.5 py-1 flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} /> pick
                </label>
              )}
              {d.confidence != null && (
                <span
                  className={`absolute top-2 right-2 z-10 rounded px-1.5 py-0.5 text-xs font-medium ${
                    d.confidence >= 0.8 ? "bg-green-100 text-green-900" : d.confidence >= 0.6 ? "bg-yellow-100 text-yellow-900" : "bg-red-100 text-red-900"
                  }`}
                >
                  {Math.round(d.confidence * 100)}%
                </span>
              )}
              <Link href={`/admin/listings/${d.id}`} className="block">
                <div className="aspect-square bg-brand-ink/5 flex items-center justify-center overflow-hidden">
                  {d.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.cover} alt="" className="object-contain w-full h-full" />
                  ) : (
                    <span className="text-xs text-brand-ink/40">
                      {d.photos} photo{d.photos === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="p-3 text-sm">
                  <p className="font-medium line-clamp-2">{d.title ?? d.titleHint ?? "Untitled item"}</p>
                  <p className="text-xs text-brand-ink/60 mt-1">
                    {STATUS_LABEL[d.status] ?? d.status} · {SOURCE_LABEL[d.source] ?? d.source}
                    {d.binSku && <> · bin {d.binSku}</>}
                    {d.price != null && <> · ${d.price.toFixed(2)}</>}
                    {d.tier && <> · {d.tier}</>}
                  </p>
                  {d.generationError && d.status !== "generating" && (
                    <p className="text-xs text-red-800 mt-1 line-clamp-2">Write failed: {d.generationError}</p>
                  )}
                  {d.sourceLabel && <p className="text-xs text-brand-ink/40 mt-1 truncate">{d.sourceLabel}</p>}
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
