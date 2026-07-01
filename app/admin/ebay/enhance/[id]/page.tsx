// /admin/ebay/enhance/[id] — batch detail: header, config, per-job
// results with before/after values. The full rollback UI is Phase 5;
// the before/after snapshots shown here are already being captured.

import { db, enhanceBatches, enhanceJobs } from "@/db";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import CancelBatchButton from "./CancelBatchButton";

export const dynamic = "force-dynamic";

const JOB_DISPLAY_CAP = 500;

const usd = (n: number) => `$${n.toFixed(2)}`;

export default async function BatchDetail({
  params,
}: {
  params: { id: string };
}) {
  const [batch] = await db
    .select()
    .from(enhanceBatches)
    .where(eq(enhanceBatches.id, params.id))
    .limit(1);
  if (!batch) notFound();

  const jobs = await db
    .select()
    .from(enhanceJobs)
    .where(eq(enhanceJobs.batchId, batch.id))
    .orderBy(asc(enhanceJobs.createdAt))
    .limit(JOB_DISPLAY_CAP);

  const active = batch.status === "pending" || batch.status === "running";

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/ebay/enhance" className="hover:underline">
          Expert Enhance
        </Link>{" "}
        / batch
      </p>
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <h1 className="font-marker text-3xl md:text-4xl">
          {batch.label || batch.op}
        </h1>
        {active && <CancelBatchButton batchId={batch.id} />}
      </div>
      <p className="text-sm text-brand-ink/60 mb-6">
        {batch.op} · created{" "}
        {batch.createdAt.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
        {batch.completedAt &&
          ` · finished ${batch.completedAt.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}`}
      </p>

      <div className="grid gap-4 sm:grid-cols-4 mb-6">
        <Stat label="Status" value={batch.status} />
        <Stat
          label="Progress"
          value={`${batch.completedJobs + batch.failedJobs + batch.skippedJobs} / ${batch.totalJobs}`}
          hint={`${batch.completedJobs} done · ${batch.failedJobs} failed · ${batch.skippedJobs} skipped`}
        />
        <Stat
          label="Est. cost"
          value={batch.estimatedCostUsd ? usd(Number(batch.estimatedCostUsd)) : "—"}
        />
        <Stat label="Actual cost" value={usd(Number(batch.actualCostUsd))} />
      </div>

      <div className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-8">
        <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
          Config
        </p>
        <pre className="text-xs font-mono text-brand-ink/80 whitespace-pre-wrap">
          {JSON.stringify(batch.config, null, 2)}
        </pre>
      </div>

      <h2 className="font-medium text-lg mb-3">
        Jobs{" "}
        {batch.totalJobs > JOB_DISPLAY_CAP && (
          <span className="text-sm text-brand-ink/50 font-normal">
            (first {JOB_DISPLAY_CAP} of {batch.totalJobs})
          </span>
        )}
      </h2>
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-brand-ink/40">
              <th className="pb-2 pr-4">SKU</th>
              <th className="pb-2 pr-4">Title</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Before → After</th>
              <th className="pb-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-brand-ink/5 align-top">
                <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                  {j.sku ?? "—"}
                </td>
                <td className="py-2 pr-4 max-w-xs">
                  <a
                    href={`https://www.ebay.com/itm/${j.ebayItemId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline underline-offset-2 decoration-brand-yellow decoration-2"
                  >
                    {j.title ?? j.ebayItemId}
                  </a>
                </td>
                <td className="py-2 pr-4">
                  <JobBadge status={j.status} />
                </td>
                <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                  {renderDiff(j.before, j.after)}
                </td>
                <td className="py-2 text-xs text-brand-ink/60 max-w-sm">
                  {j.errorMessage ??
                    (j.result && "reason" in j.result
                      ? String((j.result as Record<string, unknown>).reason)
                      : "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    if (a === undefined) parts.push(`${k}: ${fmt(b)}`);
    else parts.push(`${k}: ${fmt(b)} → ${fmt(a)}`);
  }
  return parts.join(" · ");
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v % 1 === 0 ? String(v) : v.toFixed(2);
  return String(v);
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
        {label}
      </p>
      <p className="font-medium text-lg">{value}</p>
      {hint && <p className="text-xs text-brand-ink/50 mt-1">{hint}</p>}
    </div>
  );
}

function JobBadge({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? "bg-brand-yellow text-brand-ink"
      : status === "running"
      ? "bg-brand-ink text-brand-paper"
      : status === "failed"
      ? "bg-red-100 text-red-800"
      : "bg-brand-ink/10 text-brand-ink/60";
  return (
    <span className={`text-xs uppercase tracking-wider px-2 py-0.5 rounded ${cls}`}>
      {status}
    </span>
  );
}
