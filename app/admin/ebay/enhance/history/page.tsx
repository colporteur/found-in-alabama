// /admin/ebay/enhance/history — cross-batch history browser (Phase 5).
// Every mutation the pipeline has made, newest first, with per-item
// rollback and the 24h session rollback.

import { db, enhanceBatches, enhanceJobs } from "@/db";
import { ENHANCE_OPS, type EnhanceOp } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { decodeEntities } from "@/lib/ebay/entities";
import { rollbackEligibility } from "@/lib/enhance/rollback";
import {
  JobRollbackButton,
  SessionRollbackButton,
} from "../RollbackControls";

export const dynamic = "force-dynamic";

const HISTORY_CAP = 200;

export default async function EnhanceHistory({
  searchParams,
}: {
  searchParams: { op?: string };
}) {
  const opFilter: EnhanceOp | "" = (ENHANCE_OPS as readonly string[]).includes(
    searchParams.op ?? ""
  )
    ? (searchParams.op as EnhanceOp)
    : "";

  const rows = await db
    .select({
      job: enhanceJobs,
      op: enhanceBatches.op,
      batchLabel: enhanceBatches.label,
    })
    .from(enhanceJobs)
    .innerJoin(enhanceBatches, eq(enhanceJobs.batchId, enhanceBatches.id))
    .where(opFilter ? eq(enhanceBatches.op, opFilter) : undefined)
    .orderBy(desc(enhanceJobs.completedAt))
    .limit(HISTORY_CAP);

  const ops: Array<EnhanceOp | ""> = ["", ...ENHANCE_OPS];

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/ebay/enhance" className="hover:underline">
          Expert Enhance
        </Link>{" "}
        / history
      </p>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="font-marker text-3xl md:text-4xl mb-2">Change history</h1>
          <p className="text-sm text-brand-ink/60 max-w-xl">
            Every mutation the pipeline has applied, newest first (latest{" "}
            {HISTORY_CAP} shown). Rollbacks restore the before-value via
            ReviseItem and never touch values you&rsquo;ve edited by hand since.
          </p>
        </div>
        <SessionRollbackButton />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {ops.map((o) => (
          <Link
            key={o || "all"}
            href={o ? `/admin/ebay/enhance/history?op=${o}` : "/admin/ebay/enhance/history"}
            className={`text-xs px-3 py-1.5 rounded border ${
              opFilter === o
                ? "bg-brand-ink text-brand-paper border-brand-ink"
                : "bg-white border-brand-ink/20 hover:border-brand-ink"
            }`}
          >
            {o || "All ops"}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-8 text-center text-sm text-brand-ink/50">
          No history yet{opFilter ? ` for ${opFilter}` : ""}.
        </div>
      ) : (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-brand-ink/40">
                <th className="pb-2 pr-4">When</th>
                <th className="pb-2 pr-4">Op</th>
                <th className="pb-2 pr-4">Item</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Before → After</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ job: j, op, batchLabel }) => (
                <tr key={j.id} className="border-t border-brand-ink/5 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-xs text-brand-ink/60">
                    {j.completedAt
                      ? j.completedAt.toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <Link
                      href={`/admin/ebay/enhance/${j.batchId}`}
                      className="hover:underline underline-offset-2 decoration-brand-yellow decoration-2"
                      title={batchLabel || undefined}
                    >
                      {op}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 max-w-xs">
                    <a
                      href={`https://www.ebay.com/itm/${j.ebayItemId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline underline-offset-2 decoration-brand-yellow decoration-2"
                    >
                      <span className="block truncate">
                        {j.title ? decodeEntities(j.title) : j.ebayItemId}
                      </span>
                    </a>
                    <span className="font-mono text-xs text-brand-ink/40">
                      {j.sku ?? ""}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`text-xs uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap ${
                        j.status === "completed"
                          ? "bg-brand-yellow text-brand-ink"
                          : j.status === "failed"
                          ? "bg-red-100 text-red-800"
                          : "bg-brand-ink/10 text-brand-ink/60"
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {renderDiff(j.before, j.after)}
                  </td>
                  <td className="py-2 text-right">
                    {j.rolledBack ? (
                      <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-brand-ink/10 text-brand-ink/60 whitespace-nowrap">
                        rolled back
                      </span>
                    ) : rollbackEligibility(j, op).ok ? (
                      <JobRollbackButton jobId={j.id} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-brand-ink/10">
        <Link
          href="/admin/ebay/enhance"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          ← Back to Expert Enhance
        </Link>
      </div>
    </section>
  );
}

function renderDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string {
  if (!before && !after) return "—";
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const parts: string[] = [];
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (isObj(b) || isObj(a)) {
      const innerKeys = new Set([
        ...Object.keys(isObj(b) ? b : {}),
        ...Object.keys(isObj(a) ? a : {}),
      ]);
      for (const ik of innerKeys) {
        const ib = isObj(b) ? b[ik] : undefined;
        const ia = isObj(a) ? a[ik] : undefined;
        parts.push(`${ik}: ${fmt(ib)} → ${fmt(ia)}`);
      }
      continue;
    }
    if (a === undefined) parts.push(`${k}: ${fmt(b)}`);
    else parts.push(`${k}: ${fmt(b)} → ${fmt(a)}`);
  }
  const joined = parts.join(" · ");
  return joined.length > 160 ? `${joined.slice(0, 160)}…` : joined;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v % 1 === 0 ? String(v) : v.toFixed(2);
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}
