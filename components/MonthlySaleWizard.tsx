"use client";

// Monthly sale wizard on /admin/ebay/sales/new.
//
// Press "Preview month" → see the computed 4-week calendar (every store
// category gets one 2-day sale). Adjust the discount, choose whether to
// enqueue weekly social posts, then "Create sales" executes the plan in
// chunks with a progress readout. Re-running skips categories that
// already have a sale this month, so a failed run can simply be resumed.

import { useState } from "react";

type PlanEntry = {
  categoryId: string;
  categoryName: string;
  startsAt: string;
  endsAt: string;
  alreadyCreated?: boolean;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function MonthlySaleWizard() {
  const [plan, setPlan] = useState<PlanEntry[] | null>(null);
  const [monthStartISO, setMonthStartISO] = useState<string | null>(null);
  const [discount, setDiscount] = useState(20);
  const [socialPosts, setSocialPosts] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function preview() {
    setBusy("preview");
    setResult(null);
    setErrors([]);
    try {
      const res = await fetch("/api/admin/ebay/sales/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPlan(data.plan);
      setMonthStartISO(data.monthStartISO);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Preview failed"]);
    } finally {
      setBusy(null);
    }
  }

  async function execute() {
    if (!plan || !monthStartISO) return;
    setResult(null);
    setErrors([]);
    let offset = 0;
    let created = 0;
    let skipped = 0;
    let social = 0;
    const allErrors: string[] = [];
    try {
      for (;;) {
        setBusy(`Creating sales… ${offset}/${plan.length}`);
        const res = await fetch("/api/admin/ebay/sales/wizard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "execute",
            monthStartISO,
            discountPercent: discount,
            offset,
            limit: 6,
            socialPosts,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        created += data.created ?? 0;
        skipped += data.skipped ?? 0;
        social += data.socialDraftsCreated ?? 0;
        if (Array.isArray(data.errors)) allErrors.push(...data.errors);
        offset += data.processed ?? 6;
        if (data.done) break;
      }
      setResult(
        `Created ${created} sales (${skipped} already existed)` +
          (social > 0 ? `, enqueued ${social} weekly social drafts` : "") +
          `. They're SCHEDULED on eBay and run automatically.`
      );
      setErrors(allErrors);
      // Refresh the preview so alreadyCreated flags update.
      await preview();
    } catch (err) {
      setErrors([
        ...allErrors,
        `Stopped at ${offset}: ${err instanceof Error ? err.message : "unknown"}. Press "Create sales" again to resume — finished categories are skipped.`,
      ]);
    } finally {
      setBusy(null);
    }
  }

  const pending = plan ? plan.filter((p) => !p.alreadyCreated).length : 0;

  return (
    <div className="border border-brand-ink/15 rounded-lg p-5 bg-white mb-8">
      <h2 className="font-marker text-xl mb-1">Monthly sale wizard</h2>
      <p className="text-sm text-brand-ink/70 mb-4 max-w-prose">
        One pass over the whole store: every category gets a 2-day markdown
        once over the next 4 weeks. Sales go to eBay as SCHEDULED and run
        themselves. Items already in a stale-inventory tier sale are excluded
        automatically.
      </p>

      {!plan ? (
        <button
          onClick={preview}
          disabled={busy === "preview"}
          className="text-sm px-4 py-2 bg-brand-yellow text-brand-ink font-medium rounded hover:bg-brand-yellow-dark transition-colors disabled:opacity-50"
        >
          {busy === "preview" ? "Building plan…" : "Preview month"}
        </button>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-4 mb-3">
            <div className="flex items-center gap-1 text-sm">
              <input
                type="number"
                min={1}
                max={80}
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
                className="w-16 px-2 py-1 border border-brand-ink/20 rounded text-right focus:outline-none focus:ring-2 focus:ring-brand-yellow"
              />
              <span className="text-brand-ink/60">% off everything</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={socialPosts}
                onChange={(e) => setSocialPosts(e.target.checked)}
                className="accent-brand-yellow w-4 h-4"
              />
              Enqueue weekly social posts (4)
            </label>
          </div>

          <div className="border border-brand-ink/10 rounded max-h-72 overflow-y-auto mb-3">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-brand-paper text-xs uppercase tracking-wider text-brand-ink/60">
                <tr>
                  <th className="text-left px-3 py-2">Category</th>
                  <th className="text-left px-3 py-2">Runs</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-ink/5">
                {plan.map((p) => (
                  <tr key={p.categoryId}>
                    <td className="px-3 py-1.5">{p.categoryName}</td>
                    <td className="px-3 py-1.5 text-brand-ink/70 whitespace-nowrap">
                      {fmtDate(p.startsAt)} – {fmtDate(p.endsAt)}
                    </td>
                    <td className="px-3 py-1.5">
                      {p.alreadyCreated ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          created
                        </span>
                      ) : (
                        <span className="text-xs text-brand-ink/50">pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={execute}
              disabled={!!busy || pending === 0}
              className="text-sm px-4 py-2 bg-brand-yellow text-brand-ink font-medium rounded hover:bg-brand-yellow-dark transition-colors disabled:opacity-50"
            >
              {busy && busy !== "preview"
                ? busy
                : pending === 0
                  ? "All created this month"
                  : `Create ${pending} sales`}
            </button>
            <button
              onClick={() => setPlan(null)}
              disabled={!!busy}
              className="text-sm text-brand-ink/60 hover:text-brand-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded p-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-900">
          {result}
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-3 rounded p-3 text-sm bg-red-50 border border-red-200 text-red-900">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}
