"use client";

// Shown on a lot draft: Claude combined several drafts into this one. Lists
// the pieces (and the bins they came from), Claude's reason, and "Split lot"
// to put everything back the way it was. "Keep lot open" holds the lot for
// more pieces (lib/listings/open-lots.ts); adding any closes it again.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoFitBox } from "./PhotoFitBox";

type Part = { draftId: string; title: string | null; bin: string | null; candidate?: { registryItemId: string } };

export function LotPanel({
  id,
  parts,
  reason,
  canSplit,
  fromPool = false,
  open = null,
  canOpen = false,
  additions = [],
  fit = null,
  canFit = false,
}: {
  id: string;
  parts: Part[];
  reason: string | null;
  canSplit: boolean;
  fromPool?: boolean;
  /** Held open for more pieces: since when. */
  open?: { since: string | null; days: number } | null;
  canOpen?: boolean;
  additions?: Array<{ at: string; pieces: string[]; reason: string | null }>;
  /** "Fit to 24" (lib/listings/photo-fit.ts). */
  fit?: { soloOnly: boolean; text: string; dropped: number[]; error: string | null } | null;
  canFit?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const bins = Array.from(new Set(parts.map((p) => p.bin).filter(Boolean)));

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/listings/${id}/lot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  async function split() {
    if (
      !confirm(
        fromPool
          ? `Put this lot back in the lot pool? The lot's text is cleared and its ${parts.length} pieces wait in the pool again.`
          : `Split this lot back into ${parts.length} drafts? The lot's title, description and price are cleared; every piece goes back to Ready.`
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/listings/${id}/lot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "split" }),
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

  return (
    <div className="mb-6 rounded-lg border-2 border-purple-700 bg-purple-50 p-4 text-sm">
      <p className="font-bold text-purple-900">
        <span className="mr-2 rounded bg-purple-700 px-1.5 py-0.5 text-white">LOT of {parts.length}</span>
        Claude combined these drafts into one listing — give it a careful look.
      </p>
      {open && (
        <div className="mt-3 rounded border-2 border-teal-700 bg-teal-50 p-3 text-teal-900">
          <p className="font-bold">
            <span className="mr-2 rounded bg-teal-700 px-1.5 py-0.5 text-white">OPEN LOT</span>
            Waiting for more pieces{open.days > 0 ? ` (open ${open.days} day${open.days === 1 ? "" : "s"})` : ""}.
          </p>
          <p className="mt-1">
            When you send the next pieces to Claude, it checks them against this lot and adds the ones that belong. You can also add a piece
            yourself from its draft page (&ldquo;Add to an open lot&rdquo;). Adding anything closes the lot and sends it back to Claude to rewrite.
          </p>
          {open.days >= 21 && <p className="mt-1 font-semibold">It&apos;s been open a while — close it if nothing else is coming.</p>}
          <button type="button" onClick={() => post({ action: "close" })} disabled={busy} className="mt-2 rounded border border-teal-700 px-3 py-1.5 hover:bg-teal-100 disabled:opacity-50">
            Close lot (nothing more coming)
          </button>
        </div>
      )}
      {reason && <p className="mt-2 text-purple-900/80">Why: {reason}</p>}
      <ol className="mt-2 list-decimal pl-5 text-purple-900/90">
        {parts.map((p, i) => (
          <li key={p.draftId}>
            {p.candidate ? (
              <Link href={`/admin/inventory/${p.candidate.registryItemId}`} className="underline">{p.title ?? "item"}</Link>
            ) : p.draftId === id || !p.draftId ? (
              p.title ?? "item"
            ) : (
              <Link href={`/admin/listings/${p.draftId}`} className="underline">{p.title ?? "item"}</Link>
            )}
            {p.candidate && <span className="ml-1 text-xs">(was listed on its own — pull it from its old bin)</span>}
            {p.bin && <span className="ml-1 font-mono text-xs">(bin {p.bin})</span>}
          </li>
        ))}
      </ol>
      {fromPool && (
        <p className="mt-2 text-purple-900/80">
          From the lot pool: the pooled pieces are in the <span className="font-mono">LOTPOOL</span> bin. Give the lot its own bin below and put
          every piece there.
        </p>
      )}
      {!fromPool && bins.length > 1 && (
        <p className="mt-2 text-purple-900/80">
          The pieces came from bins {bins.join(", ")}; the lot keeps bin <span className="font-mono">{bins[0]}</span> — put them together there.
        </p>
      )}
      {additions.length > 0 && (
        <p className="mt-2 text-purple-900/80">
          Added while open:{" "}
          {additions.map((a, i) => (
            <span key={a.at + i}>
              {i ? "; " : ""}
              {a.pieces.join(", ")} ({new Date(a.at).toLocaleDateString("en-US")}){a.reason ? ` — ${a.reason}` : ""}
            </span>
          ))}
        </p>
      )}
      {fit && <PhotoFitBox id={id} soloOnly={fit.soloOnly} text={fit.text} dropped={fit.dropped} error={fit.error} canEdit={canFit} />}
      {canOpen && !open && (
        <button
          type="button"
          onClick={() => post({ action: "keep_open" })}
          disabled={busy}
          title="More pieces for this lot are coming: hold it out of Review, and Claude adds matching pieces from your next sends"
          className="mt-3 mr-2 rounded bg-teal-700 px-3 py-1.5 text-white hover:bg-teal-800 disabled:opacity-50"
        >
          Keep lot open
        </button>
      )}
      {canSplit && (
        <button type="button" onClick={split} disabled={busy} className="mt-3 rounded border border-purple-700 px-3 py-1.5 text-purple-900 hover:bg-purple-100 disabled:opacity-50">
          {busy ? "Splitting…" : fromPool ? "Put back in the lot pool" : "Split lot"}
        </button>
      )}
      {msg && <p className="mt-2 text-red-800">{msg}</p>}
    </div>
  );
}
