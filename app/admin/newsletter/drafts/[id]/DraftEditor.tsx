"use client";

// Two-flavor newsletter editor. Subject + body for each. PATCHes on
// "Save" — no autosave yet (deliberate; lets you experiment without
// committing). Sending is wired up in Phase 4C — that button is
// disabled here.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type InitialDraft = {
  id: string;
  label: string;
  status: "draft" | "sent";
  emailSubject: string;
  ebaySubject: string;
  emailBody: string;
  ebayBody: string;
  emailRecipientCount: number | null;
  generatedAt: string;
  sentAt: string | null;
};

type Flavor = "email" | "ebay";

export default function DraftEditor({ initial }: { initial: InitialDraft }) {
  const router = useRouter();
  const [label, setLabel] = useState(initial.label);
  const [emailSubject, setEmailSubject] = useState(initial.emailSubject);
  const [ebaySubject, setEbaySubject] = useState(initial.ebaySubject);
  const [emailBody, setEmailBody] = useState(initial.emailBody);
  const [ebayBody, setEbayBody] = useState(initial.ebayBody);
  const [active, setActive] = useState<Flavor>("email");
  const [busy, setBusy] = useState<"save" | "delete" | "copy" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sendProgress, setSendProgress] = useState<{
    done: boolean;
    total: number;
    succeeded: number;
    failed: number;
    remaining: number;
    lastError?: string;
  } | null>(null);
  const [failedRows, setFailedRows] = useState<
    Array<{ email: string; error: string | null; attemptedAt: string }>
  >([]);

  // Pull failed-send rows when the draft is in sent state, so we can
  // surface them for retry.
  useEffect(() => {
    if (!sent) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/newsletter/drafts/${initial.id}/failed`
        );
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.failed)) setFailedRows(data.failed);
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sent, initial.id]);

  const sent = initial.status === "sent";

  const dirty =
    label !== initial.label ||
    emailSubject !== initial.emailSubject ||
    ebaySubject !== initial.ebaySubject ||
    emailBody !== initial.emailBody ||
    ebayBody !== initial.ebayBody;

  async function handleSave() {
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/admin/newsletter/drafts/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          emailSubject,
          ebaySubject,
          emailBody,
          ebayBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/admin/newsletter/drafts/${initial.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      router.push("/admin/newsletter/drafts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  async function handleSend() {
    if (sent) return;
    if (
      !confirm(
        `Send to all confirmed subscribers? This cannot be undone. The draft will be locked once sending completes.`
      )
    )
      return;
    setBusy("send");
    setError(null);
    setSendProgress({ done: false, total: 0, succeeded: 0, failed: 0, remaining: 0 });
    try {
      // Poll the budgeted send endpoint until done.
      for (let pass = 0; pass < 60; pass++) {
        const res = await fetch(
          `/api/admin/newsletter/drafts/${initial.id}/send`,
          { method: "POST" }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        setSendProgress(data);
        if (data.done) break;
        // Small breather between calls so we don't hammer
        await new Promise((r) => setTimeout(r, 500));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleRetryFailed() {
    if (!confirm(`Retry the ${failedRows.length} failed send${failedRows.length === 1 ? "" : "s"}? Successful sends will not be re-emailed.`)) return;
    setBusy("send");
    setError(null);
    try {
      // Wipe failed log rows so /send will queue them again
      const wipe = await fetch(
        `/api/admin/newsletter/drafts/${initial.id}/retry-failed`,
        { method: "POST" }
      );
      if (!wipe.ok) {
        const data = await wipe.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${wipe.status}`);
      }
      setFailedRows([]);
      // Re-use the same polling loop as the initial send
      for (let pass = 0; pass < 30; pass++) {
        const res = await fetch(
          `/api/admin/newsletter/drafts/${initial.id}/send`,
          { method: "POST" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setSendProgress(data);
        if (data.done) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      // Reload failed list to show whatever's still broken
      const res = await fetch(
        `/api/admin/newsletter/drafts/${initial.id}/failed`
      );
      const data = await res.json();
      if (Array.isArray(data.failed)) setFailedRows(data.failed);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusy(null);
    }
  }

  async function copyEbayBody() {
    try {
      await navigator.clipboard.writeText(ebayBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy to clipboard — select manually instead.");
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header — label + global actions */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1 min-w-[200px] max-w-md">
          <label className="block text-xs uppercase tracking-wider text-brand-ink/55 mb-1">
            Internal label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-3 py-2 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy === "save" || !dirty || sent}
            className="px-4 py-2 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors disabled:opacity-50 text-sm"
            title={sent ? "Already sent — read-only" : ""}
          >
            {busy === "save"
              ? "Saving…"
              : sent
                ? "Sent (read-only)"
                : dirty
                  ? "Save changes"
                  : "Saved"}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={busy === "send" || sent || dirty}
            title={
              sent
                ? "Already sent"
                : dirty
                  ? "Save changes before sending"
                  : "Send the email flavor to all confirmed subscribers"
            }
            className="px-4 py-2 bg-emerald-700 text-white font-medium rounded-md text-sm hover:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === "send"
              ? "Sending…"
              : sent
                ? "Sent ✓"
                : "Send to subscribers"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy === "delete"}
            className="px-3 py-2 text-sm border border-red-200 text-red-700 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {savedAt && !dirty && (
        <p className="text-xs text-emerald-700">Saved at {savedAt}</p>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {sendProgress && (
        <div className={`rounded-md p-3 text-sm border ${
          sendProgress.done
            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-brand-yellow/15 border-brand-yellow/40 text-brand-ink"
        }`}>
          {sendProgress.done ? (
            <p className="font-medium mb-1">
              Sent. {sendProgress.succeeded} delivered{sendProgress.failed > 0 ? `, ${sendProgress.failed} failed` : ""}.
            </p>
          ) : (
            <p className="font-medium mb-1">
              Sending… {sendProgress.succeeded} / {sendProgress.total} delivered
              {sendProgress.failed > 0 ? ` (${sendProgress.failed} failed)` : ""}.
            </p>
          )}
          {sendProgress.lastError && (
            <p className="text-xs">Most recent error: {sendProgress.lastError}</p>
          )}
        </div>
      )}

      {sent && failedRows.length > 0 && (
        <div className="rounded-md p-3 border bg-red-50 border-red-200 text-red-900">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <p className="font-medium text-sm">
              {failedRows.length} send{failedRows.length === 1 ? "" : "s"} failed
            </p>
            <button
              type="button"
              onClick={handleRetryFailed}
              disabled={busy === "send"}
              className="text-xs px-3 py-1.5 bg-brand-ink text-brand-paper rounded hover:bg-brand-ink/90 transition-colors disabled:opacity-50"
            >
              {busy === "send" ? "Retrying…" : "Retry failed sends"}
            </button>
          </div>
          <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
            {failedRows.map((f, i) => (
              <li key={i} className="border-t border-red-200 pt-1 first:border-t-0 first:pt-0">
                <span className="font-medium">{f.email}</span>
                {f.error ? <span className="text-red-700"> — {f.error}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Flavor tabs */}
      <div className="border-b border-brand-ink/15 flex gap-1">
        {(["email", "ebay"] as Flavor[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setActive(f)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active === f
                ? "border-brand-yellow text-brand-ink"
                : "border-transparent text-brand-ink/60 hover:text-brand-ink"
            }`}
          >
            {f === "email" ? "Email subscribers (cross-marketplace)" : "eBay Seller Hub (eBay-only)"}
          </button>
        ))}
      </div>

      {/* Flavor body */}
      {active === "email" ? (
        <div className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-brand-ink/55 mb-1">
              Email subject
            </label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="w-full px-3 py-2 border border-brand-ink/20 rounded-md font-medium bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
            <p className="text-xs text-brand-ink/55 mt-1">
              {emailSubject.length} chars
            </p>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-brand-ink/55 mb-1">
              Body (markdown) · {emailBody.length} chars
            </label>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={24}
              className="w-full px-3 py-2 border border-brand-ink/20 rounded-md text-sm leading-relaxed bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow font-mono resize-y"
            />
            <p className="text-xs text-brand-ink/55 mt-1">
              Markdown. Will be rendered to HTML at send time. Links go to product pages on foundinalabama.com so buyers can pick their preferred marketplace.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
            <p className="font-medium">
              eBay flavor — for Seller Hub paste, not for sending to your list.
            </p>
            <p className="mt-1">
              Edit if needed, then click <strong>Copy eBay body</strong> below
              and paste into eBay&rsquo;s Seller Hub email tool. All links
              here point only to eBay listings (Seller Hub rejects external
              links to competitors).
            </p>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-brand-ink/55 mb-1">
              eBay subject
            </label>
            <input
              type="text"
              value={ebaySubject}
              onChange={(e) => setEbaySubject(e.target.value)}
              className="w-full px-3 py-2 border border-brand-ink/20 rounded-md font-medium bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
            <p className="text-xs text-brand-ink/55 mt-1">
              {ebaySubject.length} chars
            </p>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-brand-ink/55 mb-1">
              Body (markdown) · {ebayBody.length} chars
            </label>
            <textarea
              value={ebayBody}
              onChange={(e) => setEbayBody(e.target.value)}
              rows={24}
              className="w-full px-3 py-2 border border-brand-ink/20 rounded-md text-sm leading-relaxed bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow font-mono resize-y"
            />
          </div>
          <button
            type="button"
            onClick={copyEbayBody}
            disabled={busy === "copy"}
            className="inline-flex items-center px-4 py-2 bg-brand-ink text-brand-paper font-medium rounded-md hover:bg-brand-ink/90 transition-colors text-sm"
          >
            {copied ? "Copied!" : "Copy eBay body"}
          </button>
        </div>
      )}
    </div>
  );
}
