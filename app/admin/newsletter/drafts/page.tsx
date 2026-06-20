// Admin list of saved newsletter drafts. Shows status, label, subject
// lines, generation date, and a button to open the editor or generate a
// fresh one.

import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db, newsletterDrafts } from "@/db";
import { desc } from "drizzle-orm";
import GenerateDraftButton from "./GenerateDraftButton";

export const dynamic = "force-dynamic";

function formatWhen(iso: Date | string | null): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function DraftsPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  const drafts = await db
    .select({
      id: newsletterDrafts.id,
      label: newsletterDrafts.label,
      status: newsletterDrafts.status,
      emailSubject: newsletterDrafts.emailSubject,
      ebaySubject: newsletterDrafts.ebaySubject,
      emailRecipientCount: newsletterDrafts.emailRecipientCount,
      generatedAt: newsletterDrafts.generatedAt,
      sentAt: newsletterDrafts.sentAt,
    })
    .from(newsletterDrafts)
    .orderBy(desc(newsletterDrafts.generatedAt))
    .limit(50);

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Newsletter
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">Drafts</h1>
        </div>
        <div className="flex gap-4 text-sm">
          <Link
            href="/admin/newsletter"
            className="hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
          >
            ← Subscribers
          </Link>
          <Link
            href="/admin"
            className="text-brand-ink/60 hover:text-brand-ink"
          >
            Dashboard
          </Link>
        </div>
      </div>

      <p className="text-brand-ink/70 mb-6 max-w-prose">
        Generated newsletter drafts. Click any to edit the subject lines or
        body of either flavor (email subscribers vs. eBay Seller Hub), then
        send to your confirmed subscribers or copy the eBay flavor into
        Seller Hub.
      </p>

      <div className="mb-8">
        <GenerateDraftButton />
      </div>

      {drafts.length === 0 ? (
        <p className="text-sm text-brand-ink/60 italic">
          No drafts yet. Click <strong>Generate new draft</strong> above to
          have Claude draft this month&rsquo;s newsletter from your hauls,
          inventory, and sales.
        </p>
      ) : (
        <div className="border border-brand-ink/15 rounded-lg overflow-hidden bg-white divide-y divide-brand-ink/10">
          {drafts.map((d) => (
            <Link
              key={d.id}
              href={`/admin/newsletter/drafts/${d.id}`}
              className="block p-4 hover:bg-brand-paper/50 transition-colors"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded ${
                      d.status === "sent"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-brand-yellow/30 text-brand-ink"
                    }`}
                  >
                    {d.status}
                  </span>
                  <p className="font-medium">{d.label}</p>
                </div>
                <p className="text-xs text-brand-ink/55">
                  {d.status === "sent"
                    ? `sent ${formatWhen(d.sentAt)}`
                    : `generated ${formatWhen(d.generatedAt)}`}
                </p>
              </div>
              <p className="text-sm text-brand-ink/75 truncate">
                <span className="text-brand-ink/55 text-xs uppercase tracking-wider mr-2">
                  email
                </span>
                {d.emailSubject}
              </p>
              <p className="text-sm text-brand-ink/75 truncate">
                <span className="text-brand-ink/55 text-xs uppercase tracking-wider mr-2">
                  ebay
                </span>
                {d.ebaySubject}
              </p>
              {d.emailRecipientCount != null && (
                <p className="text-xs text-brand-ink/55 mt-1">
                  {d.emailRecipientCount} confirmed subscriber
                  {d.emailRecipientCount === 1 ? "" : "s"} at generation time
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
