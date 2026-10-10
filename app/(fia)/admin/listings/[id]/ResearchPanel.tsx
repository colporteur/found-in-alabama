"use client";

// Research (LIST-4): a sparing deep look at this item with the strongest
// model + web search + the Expert Guides. Findings come back labelled
// confirmed / likely / possible; tick the ones the next write should use.
// Unconfirmed ones are written hedged ("likely…", "appears to be…").

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Research } from "@/lib/listings/research";

const BADGE: Record<string, string> = {
  confirmed: "bg-green-100 text-green-900",
  likely: "bg-yellow-100 text-yellow-900",
  possible: "bg-gray-100 text-gray-700",
};

export function ResearchPanel({ id, status, research }: { id: string; status: string; research: Research | null }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [use, setUse] = useState<Set<number>>(new Set((research?.findings ?? []).map((f, i) => (f.use ? i : -1)).filter((i) => i >= 0)));
  const [titleOk, setTitleOk] = useState(research?.titleOk ?? false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canWrite = ["ready", "review", "sent_back"].includes(status);

  async function call(url: string, body: unknown, label: string) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || out.ok === false) throw new Error(String(out.error ?? `HTTP ${res.status}`));
      return out;
    } catch (err) {
      setMsg((err as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    const out = await call(`/api/admin/listings/${id}/research`, { question }, "research");
    if (out) {
      const r = out.research as Research;
      setUse(new Set(r.findings.map((f, i) => (f.use ? i : -1)).filter((i) => i >= 0)));
      setTitleOk(false);
      setMsg(`Done · $${r.costUsd.toFixed(2)}`);
      router.refresh();
    }
  }

  async function savePicks() {
    return call(`/api/admin/listings/${id}/research`, { action: "picks", use: Array.from(use), titleOk }, "picks");
  }

  async function rewrite() {
    if (!(await savePicks())) return;
    const out = await call(`/api/admin/listings/${id}/generate`, { tier: "auto" }, "rewrite");
    if (out) {
      setMsg("Rewritten with the research.");
      router.refresh();
    }
  }

  const toggle = (i: number) =>
    setUse((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-8 text-sm">
      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">Research</h2>
      <p className="text-brand-ink/60 mb-3">
        For the items worth it: the strongest model searches the web and leans on the Expert Guides for where it&apos;s
        from, who made it, when, and what collectors look for. Usually a few tens of cents. Nothing changes until you
        rewrite.
      </p>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Optional: what to look into (e.g. where was Goldenson's?)"
          className="border rounded px-3 py-2 flex-1 min-w-[16rem]"
        />
        <button
          type="button"
          onClick={run}
          disabled={busy !== null || ["published", "discarded"].includes(status)}
          className="px-4 py-2 rounded font-medium bg-brand-earth text-white hover:bg-brand-earth/80 disabled:opacity-50"
        >
          {busy === "research" ? "Researching… (up to a minute or two)" : research ? "Research again" : "Research"}
        </button>
      </div>

      {research && (
        <div>
          <p className="mb-2">
            {research.summary}{" "}
            <span className="text-xs text-brand-ink/50">
              ({new Date(research.at).toLocaleString("en-US")} · {research.model} · ${research.costUsd.toFixed(2)})
            </span>
          </p>
          {research.findings.length === 0 ? (
            <p className="text-brand-ink/60">No findings.</p>
          ) : (
            <ul className="space-y-2 mb-3">
              {research.findings.map((f, i) => (
                <li key={i} className="flex gap-2 items-start">
                  <input type="checkbox" className="mt-1" checked={use.has(i)} onChange={() => toggle(i)} />
                  <div>
                    <span className={`text-xs px-1.5 py-0.5 rounded mr-1 ${BADGE[f.confidence]}`}>{f.confidence}</span>
                    <span className="text-xs text-brand-ink/50 mr-1">{f.topic}</span>
                    {f.finding}
                    {f.wording && <div className="text-xs text-brand-ink/70 mt-0.5">Would read: &ldquo;{f.wording}&rdquo;</div>}
                    {f.evidence && <div className="text-xs text-brand-ink/50 mt-0.5">Evidence: {f.evidence}</div>}
                    {f.sources.length > 0 && (
                      <div className="text-xs mt-0.5">
                        {f.sources.map((u, k) => (
                          <a key={k} href={u} target="_blank" rel="noreferrer" className="underline mr-2 break-all">
                            source {k + 1}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {research.keywords.length > 0 && (
            <p className="text-xs text-brand-ink/60 mb-2">Search words: {research.keywords.join(", ")}</p>
          )}
          {research.questions.length > 0 && (
            <div className="text-xs text-brand-ink/70 mb-3">
              Worth checking on the item:
              <ul className="list-disc pl-4">
                {research.questions.map((q, k) => (
                  <li key={k}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={titleOk} onChange={(e) => setTitleOk(e.target.checked)} /> OK to put a
              &ldquo;likely&rdquo; place in the title (as a search word)
            </label>
            <button type="button" onClick={savePicks} disabled={busy !== null} className="px-3 py-1.5 rounded border border-brand-ink/20 disabled:opacity-50">
              {busy === "picks" ? "Saving…" : "Save picks"}
            </button>
            <button
              type="button"
              onClick={rewrite}
              disabled={busy !== null || !canWrite}
              className="px-3 py-1.5 rounded bg-brand-ink text-white disabled:opacity-50"
              title={canWrite ? "" : "Unapprove it first"}
            >
              {busy === "rewrite" ? "Rewriting…" : "Rewrite with research"}
            </button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-brand-ink/70">{msg}</p>}
    </div>
  );
}
