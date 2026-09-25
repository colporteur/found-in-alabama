"use client";

// Pirate Ship bridge (Phase SHIP-1). Pirate Ship has no API, so:
//  1. Download → CSV of paid, unshipped TES orders → Pirate Ship
//     "Upload a spreadsheet" (it remembers the column mapping).
//  2. Buy the labels in Pirate Ship.
//  3. Pirate Ship → Reports / Ship history → export CSV → Import here;
//     each order gets its tracking number and is marked shipped.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ImportResult = {
  ok: boolean;
  error?: string;
  recorded?: { orderId: string; tracking: string; line: number }[];
  alreadyHad?: { orderId: string; tracking: string; line: number }[];
  unmatched?: { line: number; tracking: string; reason: string }[];
  voidedSkipped?: number;
};

export default function PirateShipPanel({
  newCount,
  awaitingTracking,
}: {
  newCount: number;
  awaitingTracking: number;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function download(scope: "new" | "unshipped") {
    // A plain navigation lets the browser handle the attachment; refresh
    // afterwards so the "sent to Pirate Ship" stamps show.
    window.location.href = `/api/admin/tes-orders/pirate-ship?scope=${scope}`;
    setTimeout(() => router.refresh(), 1500);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setResult(null);
    try {
      const csv = await f.text();
      const res = await fetch("/api/admin/tes-orders/tracking-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const body = (await res.json()) as ImportResult;
      setResult(body);
      router.refresh();
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="mb-10 bg-white border border-brand-ink/15 rounded-lg p-5">
      <h2 className="font-medium text-lg mb-1">Ship with Pirate Ship</h2>
      <p className="text-sm text-brand-ink/60 mb-4 max-w-prose">
        <strong className="text-brand-ink">{newCount}</strong> paid{" "}
        {newCount === 1 ? "order is" : "orders are"} ready to send ·{" "}
        <strong className="text-brand-ink">{awaitingTracking}</strong> sent and
        waiting on tracking. Upload the download in Pirate Ship → Ship →
        Upload a spreadsheet, buy the labels, then import Pirate Ship&apos;s
        shipment export here.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => download("new")}
          disabled={newCount === 0}
          className="text-sm px-4 py-2 rounded font-medium bg-brand-ink text-white hover:opacity-90 disabled:opacity-40"
        >
          Download {newCount || ""} new {newCount === 1 ? "order" : "orders"}
        </button>
        <button
          type="button"
          onClick={() => download("unshipped")}
          disabled={newCount + awaitingTracking === 0}
          className="text-sm px-4 py-2 rounded font-medium border border-brand-ink/20 hover:bg-brand-ink/5 disabled:opacity-40"
        >
          Re-download all unshipped
        </button>
        <label className="text-sm px-4 py-2 rounded font-medium border border-brand-ink/20 hover:bg-brand-ink/5 cursor-pointer">
          {busy ? "Importing…" : "Import tracking CSV"}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onFile}
            disabled={busy}
          />
        </label>
        <a
          href="https://ship.pirateship.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-brand-earth hover:underline"
        >
          Open Pirate Ship ↗
        </a>
      </div>

      {result && (
        <div className="mt-4 text-sm border-t border-brand-ink/10 pt-3">
          {!result.ok ? (
            <p className="text-red-700">{result.error ?? "Import failed."}</p>
          ) : (
            <>
              <p>
                <strong className="text-green-700">
                  {result.recorded?.length ?? 0} marked shipped
                </strong>
                {result.alreadyHad?.length ? ` · ${result.alreadyHad.length} already had tracking` : ""}
                {result.voidedSkipped ? ` · ${result.voidedSkipped} voided labels skipped` : ""}
                {result.unmatched?.length ? ` · ${result.unmatched.length} not TES orders` : ""}
              </p>
              {result.unmatched && result.unmatched.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-brand-ink/60">Unmatched rows</summary>
                  <ul className="mt-1 space-y-0.5 text-brand-ink/70">
                    {result.unmatched.map((u) => (
                      <li key={`${u.line}-${u.tracking}`}>
                        Row {u.line} · {u.tracking} — {u.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
