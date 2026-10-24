"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Fix = { itemId: string; title: string; price: number };

/** Move single cards FIA already listed onto the right shipping policy. */
export function CardShippingFix({ list }: { list: Fix[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/ebay-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fixCardShipping" }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.error ?? `HTTP ${res.status}`);
      const failed = (out.failed ?? []) as Array<Fix & { error: string }>;
      setMsg(
        `Updated ${out.fixed?.length ?? 0} on eBay.` +
          (failed.length ? ` ${failed.length} failed: ${failed.map((f) => `${f.itemId} (${f.error})`).join("; ")}` : "")
      );
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!list.length && !msg) return <p className="text-sm text-brand-ink/60 mt-3">All single cards FIA listed are on the right shipping policy.</p>;
  return (
    <div className="mt-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm space-y-2">
      {list.length > 0 && (
        <>
          <p>
            <b>
              {list.length} card{list.length === 1 ? "" : "s"} FIA listed {list.length === 1 ? "is" : "are"} on the wrong shipping policy
            </b>{" "}
            for {list.length === 1 ? "its" : "their"} price.
          </p>
          <ul className="list-disc pl-5 text-xs">
            {list.map((f) => (
              <li key={f.itemId}>
                <a className="underline" href={`https://www.ebay.com/itm/${f.itemId}`} target="_blank" rel="noreferrer">
                  {f.title.slice(0, 70)}
                </a>{" "}
                ${f.price.toFixed(2)}
              </li>
            ))}
          </ul>
          <button type="button" onClick={run} disabled={busy} className="px-3 py-1.5 rounded bg-brand-ink text-white disabled:opacity-50">
            {busy ? "Updating on eBay…" : `Change ${list.length} on eBay`}
          </button>
        </>
      )}
      {msg && <p>{msg}</p>}
    </div>
  );
}
