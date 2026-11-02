"use client";

// "Your order has shipped" email for a website order (lib/tes/ship-notice.ts).
// With tracking it goes out by itself when tracking is recorded; for stamped
// mail, add a photo of the stamped mailpiece (optional — take one with the
// phone camera or pick one from the photo library), then "Mailed by stamp — email buyer". Sent from the store the
// order came from.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { downsize } from "../listings/photoPrep";

export default function ShipNoticePanel({
  orderId,
  storeName,
  hasEmail,
  tracking,
  stamped,
  photo,
  sentAt,
  error,
}: {
  orderId: string;
  storeName: string;
  hasEmail: boolean;
  tracking: string | null;
  stamped: boolean;
  photo: string | null;
  sentAt: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const shipped = !!tracking || stamped;

  async function call(url: string, init: RequestInit, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, init);
      const out = (await res.json().catch(() => ({}))) as { error?: string; skipped?: string; sent?: boolean };
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      setMsg(out.skipped ? `Not emailed: ${out.skipped}.` : done);
      router.refresh();
    } catch (err) {
      setMsg(`Failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setBusy(true);
    setMsg("Uploading photo…");
    try {
      const blob = await downsize(f, 1600);
      const res = await fetch(`/api/admin/tes-orders/${orderId}/mailpiece`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      setMsg("Photo added.");
      router.refresh();
    } catch (err) {
      setMsg(`Failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const post = (action: string) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
  const post2 = (body: Record<string, unknown>) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const btn = "rounded border border-brand-ink/30 px-2 py-1 text-xs hover:bg-brand-ink/5 disabled:opacity-50";

  return (
    <div className="mt-3 rounded border border-brand-ink/10 bg-brand-ink/[0.02] p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Shipping email</span>
        {sentAt ? (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
            sent {new Date(sentAt).toLocaleString()} from {storeName}
          </span>
        ) : !hasEmail ? (
          <span className="text-xs text-brand-ink/50">no buyer email on this order</span>
        ) : shipped ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">not sent</span>
        ) : (
          <span className="text-xs text-brand-ink/50">
            goes out from {storeName} when tracking is added, or when you mark it mailed by stamp
          </span>
        )}
        {error && !sentAt && <span className="text-xs text-red-700">{error}</span>}
      </div>

      {!tracking && hasEmail && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {photo ? (
            <span className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <a href={photo} target="_blank" rel="noopener noreferrer"><img src={photo} alt="Stamped mailpiece" className="h-16 w-auto rounded border" /></a>
              {!sentAt && (
                <>
                  <button
                    type="button"
                    className={btn}
                    disabled={busy}
                    title="Turn left"
                    onClick={() => call(`/api/admin/tes-orders/${orderId}/mailpiece/rotate`, post2({ turn: -90 }), "Turned.")}
                  >
                    ⟲
                  </button>
                  <button
                    type="button"
                    className={btn}
                    disabled={busy}
                    title="Turn right"
                    onClick={() => call(`/api/admin/tes-orders/${orderId}/mailpiece/rotate`, post2({ turn: 90 }), "Turned.")}
                  >
                    ⟳
                  </button>
                  <button type="button" className={btn} disabled={busy} onClick={() => call(`/api/admin/tes-orders/${orderId}/mailpiece`, { method: "DELETE" }, "Photo removed.")}>
                    remove
                  </button>
                </>
              )}
            </span>
          ) : null}
          {!sentAt && (
            <>
              <label className={`${btn} cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
                📷 {photo ? "Retake photo" : "Take photo of the mailpiece"}
                <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => upload(e.target.files)} />
              </label>
              {/* No capture attribute: the phone offers its photo library (and files). */}
              <label className={`${btn} cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
                🖼️ {photo ? "Pick a different photo" : "Choose from photos"}
                <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => upload(e.target.files)} />
              </label>
            </>
          )}
          {!stamped && (
            <button
              type="button"
              className={`${btn} border-brand-ink bg-brand-yellow font-medium`}
              disabled={busy}
              onClick={() => {
                if (confirm(`Mark this order mailed by stamp and email the buyer from ${storeName}${photo ? " with your photo" : " (no photo)"}?`)) {
                  void call(`/api/admin/tes-orders/${orderId}/ship-notice`, post("stamped"), "Marked mailed — buyer emailed.");
                }
              }}
            >
              ✉️ Mailed by stamp — email buyer
            </button>
          )}
        </div>
      )}

      {shipped && hasEmail && (
        <div className="mt-2">
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() => call(`/api/admin/tes-orders/${orderId}/ship-notice`, post(sentAt ? "resend" : "send"), "Emailed.")}
          >
            {sentAt ? "Send again" : "Email buyer now"}
          </button>
        </div>
      )}
      {msg && <p className={`mt-1 text-xs ${/^Failed|^Not emailed/.test(msg) ? "text-red-700" : "text-green-800"}`}>{msg}</p>}
    </div>
  );
}
