// Admin overview of newsletter subscribers. Shows counts by status,
// recent signups, and a CSV export link. Sending newsletters is Phase 4C.

import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db, newsletterSubscribers } from "@/db";
import { count, desc, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function formatDate(iso: Date | string | null): string {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function NewsletterAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  // Counts per status — one round-trip with conditional aggregation.
  const [counts] = await db
    .select({
      total: count(),
      confirmed: sql<number>`count(*) filter (where ${newsletterSubscribers.status} = 'confirmed')`,
      pending: sql<number>`count(*) filter (where ${newsletterSubscribers.status} = 'pending')`,
      unsubscribed: sql<number>`count(*) filter (where ${newsletterSubscribers.status} = 'unsubscribed')`,
    })
    .from(newsletterSubscribers);

  // Last 50 signups for the list view
  const recent = await db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      status: newsletterSubscribers.status,
      source: newsletterSubscribers.source,
      createdAt: newsletterSubscribers.createdAt,
      confirmedAt: newsletterSubscribers.confirmedAt,
      unsubscribedAt: newsletterSubscribers.unsubscribedAt,
    })
    .from(newsletterSubscribers)
    .orderBy(desc(newsletterSubscribers.createdAt))
    .limit(50);

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Newsletter
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">Subscribers</h1>
        </div>
        <Link
          href="/admin"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Dashboard
        </Link>
      </div>

      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Email subscribers for the monthly newsletter. Sending — drafting and
        sending the newsletter itself — comes in Phase 4B/C.
      </p>

      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-4 mb-10">
        <Stat label="Confirmed" value={Number(counts?.confirmed ?? 0)} hint="Active subscribers" />
        <Stat label="Pending" value={Number(counts?.pending ?? 0)} hint="Sent confirm, not yet clicked" />
        <Stat label="Unsubscribed" value={Number(counts?.unsubscribed ?? 0)} hint="Permanent opt-outs" />
        <Stat label="Total" value={Number(counts?.total ?? 0)} hint="All rows on file" />
      </div>

      {/* Recent signups */}
      <h2 className="font-marker text-xl mb-3">Recent signups</h2>
      {recent.length === 0 ? (
        <p className="text-sm text-brand-ink/60 italic">
          No subscribers yet — the signup form is in the site footer.
        </p>
      ) : (
        <div className="border border-brand-ink/15 rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-brand-paper border-b border-brand-ink/10">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Email</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Source</th>
                <th className="px-4 py-2 text-left font-medium">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t border-brand-ink/10 first:border-t-0">
                  <td className="px-4 py-2.5 truncate max-w-xs">{r.email}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2.5 text-brand-ink/70">{r.source ?? "—"}</td>
                  <td className="px-4 py-2.5 text-brand-ink/70">{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-brand-ink/50 mt-6">
        Showing the {recent.length} most recent signups. For the full list, query the{" "}
        <code className="bg-brand-paper px-1 rounded">newsletter_subscribers</code> table directly via Neon.
      </p>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
        {label}
      </p>
      <p className="font-marker text-3xl mb-1">{value.toLocaleString()}</p>
      {hint && <p className="text-xs text-brand-ink/50">{hint}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "confirmed"
      ? "bg-emerald-100 text-emerald-800"
      : status === "pending"
        ? "bg-brand-yellow/30 text-brand-ink"
        : "bg-brand-ink/10 text-brand-ink/60";
  return (
    <span className={`text-xs px-2 py-0.5 rounded uppercase tracking-wider font-medium ${cls}`}>
      {status}
    </span>
  );
}
