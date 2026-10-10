// /admin/stale — shake-up report (Phase 5a). Long tail on purpose: every
// 180 days (setting) since its last shake-up, a live eBay item comes due
// for one fresh action — new title + specifics, a small markdown, a new
// description — or, for cheap items that keep sitting, a lot with others
// from its bin. Actions run through Expert Enhance (live eBay revisions
// with rollback); lots become drafts in Listings.

import Link from "next/link";
import { listGuides } from "@/lib/enhance/guides";
import { staleReady, staleReport } from "@/lib/stale/report";
import type { StaleAction } from "@/lib/stale/rules";
import { BundleList, StaleSettingsForm, StaleTable } from "./StaleControls";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIONS: Array<{ key: StaleAction; label: string; desc: string }> = [
  { key: "rewrite", label: "New title + specifics", desc: "AI rewrite of the title with an Expert Guide, and fill empty item specifics." },
  { key: "markdown", label: "Markdown", desc: "A small price cut to the nearest .87, never below the floor." },
  { key: "describe", label: "New description", desc: "AI rewrite of the description with an Expert Guide." },
  { key: "bundle", label: "Bundle into a lot", desc: "Cheap items that have sat through a couple of rounds, grouped by bin." },
];

export default async function StalePage({ searchParams }: { searchParams: { action?: string; bin?: string } }) {
  if (!(await staleReady())) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">Shake-up</h1>
        <p className="text-brand-ink/80">Run the migration (<code>npm run db:migrate</code>) first.</p>
      </section>
    );
  }
  const action = (ACTIONS.find((a) => a.key === searchParams.action)?.key ?? "rewrite") as StaleAction;
  const bin = (searchParams.bin ?? "").slice(0, 40);
  const [r, guides] = await Promise.all([staleReport({ action, bin, limit: 500 }), listGuides().catch(() => [])]);
  const families = Array.from(new Set(guides.filter((g) => g.stage !== "buy").map((g) => g.family))).sort();
  const s = r.settings;

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Inventory · analytics</p>
      <h1 className="font-marker text-4xl md:text-5xl mb-2">Shake-up</h1>
      <p className="text-sm text-brand-ink/60 mb-6 max-w-3xl">
        Nothing here says &ldquo;dump it&rdquo;. Every {s.cycleDays} days since its last shake-up, a live eBay item
        comes due for one fresh action, rotating new title + specifics → markdown → new description → markdown.
        Items under ${s.bundleMaxPrice.toFixed(2)} that have sat through {s.bundleAfterRounds} rounds become lot
        candidates. Age is the earliest date FIA knows for the item; items not on eBay aren&apos;t covered yet.
      </p>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-8">
        {[
          ["Live on eBay", r.live.toLocaleString()],
          ["Due now", r.due.toLocaleString()],
          ["Due in the next 30 days", r.dueSoon.toLocaleString()],
          ["Lot groups ready", String(r.bundles.length)],
        ].map(([k, v]) => (
          <div key={k} className="bg-white border border-brand-ink/15 rounded-lg p-3">
            <p className="text-xs uppercase tracking-wider text-brand-ink/50">{k}</p>
            <p className="text-xl font-semibold mt-1">{v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-sm mb-4">
        {ACTIONS.map((a) => (
          <Link
            key={a.key}
            href={`/admin/stale?action=${a.key}${bin ? `&bin=${encodeURIComponent(bin)}` : ""}`}
            className={`px-3 py-1 rounded-full border ${
              a.key === action ? "bg-brand-ink text-white border-brand-ink" : "border-brand-ink/20 hover:border-brand-ink/50"
            }`}
          >
            {a.label} ({r.byAction[a.key]})
          </Link>
        ))}
      </div>
      <p className="text-sm text-brand-ink/60 mb-4">{ACTIONS.find((a) => a.key === action)?.desc}</p>

      <form className="flex flex-wrap items-end gap-2 mb-6 text-sm" action="/admin/stale">
        <input type="hidden" name="action" value={action} />
        <label>
          <span className="block text-brand-ink/60 mb-1">Bin</span>
          <input name="bin" defaultValue={bin} className="border rounded px-3 py-1.5 w-40 font-mono" placeholder="any" />
        </label>
        <button className="px-3 py-1.5 rounded border border-brand-ink/20">Filter</button>
      </form>

      {action === "bundle" ? (
        <BundleList bundles={r.bundles} minItems={s.bundleMinItems} />
      ) : (
        <StaleTable items={r.items} action={action} families={families} markdownPct={s.markdownPct} />
      )}

      <details className="mt-12">
        <summary className="cursor-pointer text-sm text-brand-ink/70">Rhythm settings</summary>
        <div className="mt-4">
          <StaleSettingsForm settings={s} />
        </div>
      </details>
    </section>
  );
}
