// /admin/ebay/enhance — Expert Enhance portal (Phase 0: cost dashboard
// shell + batch history). Batch creation UI arrives with Phase 1
// (price bump + SKU rename).

import { db, enhanceBatches, aiCallLog, aiModelPricing, ebayStoreCategories } from "@/db";
import { asc, desc, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { listGuides } from "@/lib/enhance/guides";
import NewBatchForm from "./NewBatchForm";

export const dynamic = "force-dynamic";

type SpendRow = {
  op: string;
  provider: string;
  model: string;
  calls: number;
  costUsd: number;
};

async function spendSince(since: Date): Promise<SpendRow[]> {
  return db
    .select({
      op: aiCallLog.op,
      provider: aiCallLog.provider,
      model: aiCallLog.model,
      calls: sql<number>`count(*)::int`,
      costUsd: sql<number>`coalesce(sum(${aiCallLog.costUsd}), 0)::float`,
    })
    .from(aiCallLog)
    .where(gte(aiCallLog.createdAt, since))
    .groupBy(aiCallLog.op, aiCallLog.provider, aiCallLog.model)
    .orderBy(sql`sum(${aiCallLog.costUsd}) desc`);
}

const usd = (n: number) =>
  n < 0.01 && n > 0 ? `<$0.01` : `$${n.toFixed(2)}`;

export default async function EnhancePortal() {
  const now = Date.now();
  const dayAgo = new Date(now - 86_400_000);
  const weekAgo = new Date(now - 7 * 86_400_000);
  const monthAgo = new Date(now - 30 * 86_400_000);

  const [today, week, month, batches, pricing, categories] = await Promise.all([
    spendSince(dayAgo),
    spendSince(weekAgo),
    spendSince(monthAgo),
    db
      .select()
      .from(enhanceBatches)
      .orderBy(desc(enhanceBatches.createdAt))
      .limit(20),
    db.select().from(aiModelPricing).orderBy(aiModelPricing.provider),
    db
      .select({
        categoryId: ebayStoreCategories.categoryId,
        name: ebayStoreCategories.name,
      })
      .from(ebayStoreCategories)
      .orderBy(asc(ebayStoreCategories.name)),
  ]);

  const total = (rows: SpendRow[]) => rows.reduce((s, r) => s + r.costUsd, 0);

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        eBay tools
      </p>
      <h1 className="font-marker text-4xl mb-2">Expert Enhance</h1>
      <p className="text-brand-ink/70 mb-2 max-w-2xl">
        Batch improvements to live eBay listings — always via ReviseItem, so
        item IDs stay stable and Nifty crosslisting is never disrupted.
      </p>
      <p className="text-sm text-brand-ink/50 mb-10">
        Phase 1 is live: price bump/discount &amp; SKU rename. AI-powered ops
        (item specifics, guide-informed remixes, price research) arrive in
        Phases 2–4.
      </p>

      <NewBatchForm
        categories={categories}
        guides={listGuides().map((g) => ({ id: g.id, name: g.name }))}
      />

      {/* ── Spend widgets ── */}
      <div className="grid gap-4 sm:grid-cols-3 mb-4">
        <SpendStat label="Today" value={total(today)} calls={today} />
        <SpendStat label="Last 7 days" value={total(week)} calls={week} />
        <SpendStat label="Last 30 days" value={total(month)} calls={month} />
      </div>

      {month.length > 0 && (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-5 mb-10 overflow-x-auto">
          <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-3">
            Last 30 days by op + model
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-brand-ink/40">
                <th className="pb-2 pr-4">Op</th>
                <th className="pb-2 pr-4">Provider</th>
                <th className="pb-2 pr-4">Model</th>
                <th className="pb-2 pr-4 text-right">Calls</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {month.map((r, i) => (
                <tr key={i} className="border-t border-brand-ink/5">
                  <td className="py-2 pr-4">{r.op}</td>
                  <td className="py-2 pr-4">{r.provider}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.model}</td>
                  <td className="py-2 pr-4 text-right">{r.calls}</td>
                  <td className="py-2 text-right">{usd(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Batches ── */}
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-medium text-lg">Recent batches</h2>
        <a
          href="/api/cron/enhance"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Run queue now →
        </a>
      </div>
      {batches.length === 0 ? (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-8 text-center text-sm text-brand-ink/50 mb-10">
          No batches yet — create one above.
        </div>
      ) : (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-5 mb-10 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-brand-ink/40">
                <th className="pb-2 pr-4">Created</th>
                <th className="pb-2 pr-4">Op</th>
                <th className="pb-2 pr-4">Label</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4 text-right">Done / Failed / Skipped / Total</th>
                <th className="pb-2 pr-4 text-right">Est.</th>
                <th className="pb-2 text-right">Actual</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-brand-ink/5">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {b.createdAt.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-2 pr-4">{b.op}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/ebay/enhance/${b.id}`}
                      className="hover:underline underline-offset-2 decoration-brand-yellow decoration-2"
                    >
                      {b.label || "view →"}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">
                    {b.completedJobs} / {b.failedJobs} / {b.skippedJobs} /{" "}
                    {b.totalJobs}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {b.estimatedCostUsd ? usd(Number(b.estimatedCostUsd)) : "—"}
                  </td>
                  <td className="py-2 text-right">
                    {usd(Number(b.actualCostUsd))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pricing table ── */}
      <h2 className="font-medium text-lg mb-3">Model pricing</h2>
      <p className="text-sm text-brand-ink/50 mb-3 max-w-2xl">
        Rates used to compute costs, USD per million tokens (or per request
        for HTTP services). Rows seed automatically from code defaults on
        first use; edit directly in the database to correct them.
      </p>
      {pricing.length === 0 ? (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-8 text-center text-sm text-brand-ink/50">
          Nothing seeded yet — rows appear after the first AI call.
        </div>
      ) : (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-brand-ink/40">
                <th className="pb-2 pr-4">Provider</th>
                <th className="pb-2 pr-4">Model</th>
                <th className="pb-2 pr-4 text-right">In</th>
                <th className="pb-2 pr-4 text-right">Out</th>
                <th className="pb-2 pr-4 text-right">Cache rd</th>
                <th className="pb-2 pr-4 text-right">Cache wr</th>
                <th className="pb-2 pr-4 text-right">Per req</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {pricing.map((r) => (
                <tr key={`${r.provider}:${r.model}`} className="border-t border-brand-ink/5">
                  <td className="py-2 pr-4">{r.provider}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.model}</td>
                  <td className="py-2 pr-4 text-right">{r.inputPerMTok ?? "—"}</td>
                  <td className="py-2 pr-4 text-right">{r.outputPerMTok ?? "—"}</td>
                  <td className="py-2 pr-4 text-right">{r.cacheReadPerMTok ?? "—"}</td>
                  <td className="py-2 pr-4 text-right">{r.cacheWritePerMTok ?? "—"}</td>
                  <td className="py-2 pr-4 text-right">{r.perRequestUsd ?? "—"}</td>
                  <td className="py-2 text-xs text-brand-ink/50">{r.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-brand-ink/10">
        <Link
          href="/admin/ebay"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          ← Back to eBay tools
        </Link>
      </div>
    </section>
  );
}

function SpendStat({
  label,
  value,
  calls,
}: {
  label: string;
  value: number;
  calls: SpendRow[];
}) {
  const n = calls.reduce((s, r) => s + r.calls, 0);
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
        {label}
      </p>
      <p className="font-marker text-3xl mb-1">{usd(value)}</p>
      <p className="text-xs text-brand-ink/50">
        {n} call{n === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? "bg-brand-yellow text-brand-ink"
      : status === "running"
      ? "bg-brand-ink text-brand-paper"
      : status === "failed"
      ? "bg-red-100 text-red-800"
      : status === "cancelled"
      ? "bg-brand-ink/10 text-brand-ink/60"
      : "bg-brand-ink/10 text-brand-ink/60";
  return (
    <span className={`text-xs uppercase tracking-wider px-2 py-1 rounded ${cls}`}>
      {status}
    </span>
  );
}
