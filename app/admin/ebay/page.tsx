// eBay tools dashboard. Shows connection status, sync state for store
// categories and the "needs categorization" pool, plus links to the per-step
// pages. Each card here is a thin status read; the heavy actions (pull
// listings, run Claude, push revisions) live on dedicated routes.

import Link from "next/link";
import { db } from "@/db";
import {
  ebayCategorySuggestions,
  ebayListings,
  ebayStoreCategories,
} from "@/db/schema";
import { count, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function EbayDashboard() {
  const credsConfigured =
    !!process.env.EBAY_APP_ID &&
    !!process.env.EBAY_DEV_ID &&
    !!process.env.EBAY_CERT_ID &&
    !!process.env.EBAY_AUTH_TOKEN;

  const [catTotal] = await db
    .select({ count: count() })
    .from(ebayStoreCategories);
  const [catAlabama] = await db
    .select({ count: count() })
    .from(ebayStoreCategories)
    .where(eq(ebayStoreCategories.isAlabamaRelated, true));
  const [catOtherRow] = await db
    .select({
      categoryId: ebayStoreCategories.categoryId,
      name: ebayStoreCategories.name,
    })
    .from(ebayStoreCategories)
    .where(eq(ebayStoreCategories.isOtherBucket, true))
    .limit(1);

  const [listingTotal] = await db.select({ count: count() }).from(ebayListings);
  const [pendingSuggestions] = await db
    .select({ count: count() })
    .from(ebayCategorySuggestions)
    .where(eq(ebayCategorySuggestions.status, "pending"));
  const [appliedSuggestions] = await db
    .select({ count: count() })
    .from(ebayCategorySuggestions)
    .where(
      sql`${ebayCategorySuggestions.status} in ('applied', 'auto-applied')`
    );

  const lastCatSync = await db
    .select({ at: ebayStoreCategories.lastSyncedAt })
    .from(ebayStoreCategories)
    .orderBy(sql`${ebayStoreCategories.lastSyncedAt} desc`)
    .limit(1);
  const lastListingSync = await db
    .select({ at: ebayListings.lastSyncedAt })
    .from(ebayListings)
    .orderBy(sql`${ebayListings.lastSyncedAt} desc`)
    .limit(1);

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        eBay tools
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">
        Re-categorize the &ldquo;Other&rdquo; pile
      </h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Pulls every active listing whose Store Category 1 is &ldquo;Other&rdquo;
        and whose Store Category 2 is empty, asks Claude to suggest
        better-fitting store categories with extra weight on your
        Alabama-related ones, and pushes the changes back to eBay after you
        approve them.
      </p>

      <ConnectionCard configured={credsConfigured} />

      <div className="grid gap-4 sm:grid-cols-3 my-8">
        <Stat
          label="Store categories"
          value={catTotal?.count ?? 0}
          hint={
            lastCatSync[0]?.at
              ? `Last synced ${formatRelative(lastCatSync[0].at)}`
              : "Not synced yet"
          }
        />
        <Stat
          label="Alabama-flagged"
          value={catAlabama?.count ?? 0}
          hint="Used as priority targets"
        />
        <Stat
          label={"“Other” bucket"}
          value={catOtherRow ? 1 : 0}
          hint={catOtherRow?.name ?? "Auto-detected on sync"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 max-w-3xl">
        <StepCard
          step="1"
          title="Sync store categories"
          desc="Pull your full Store category tree from eBay and auto-flag the Alabama-related ones. You can edit the flags before saving."
          ready={credsConfigured}
          href="/admin/ebay/categories"
          ctaLabel={catTotal?.count ? "Review flags" : "Run sync"}
        />
        <StepCard
          step="2"
          title="Pull listings to recategorize"
          desc='Find every active listing in the "Other" bucket with no second category set. Cached locally so you can review across sessions.'
          ready={credsConfigured && !!catOtherRow}
          href="/admin/ebay/pull"
          ctaLabel={
            listingTotal?.count
              ? `${listingTotal.count} cached`
              : "Pull listings"
          }
          hint={
            lastListingSync[0]?.at
              ? `Last pulled ${formatRelative(lastListingSync[0].at)}`
              : undefined
          }
        />
        <StepCard
          step="3"
          title="Review & approve suggestions"
          desc="Claude scores each listing against your store categories. Auto-applies high-confidence matches; queues the rest for one-by-one review."
          ready={!!listingTotal?.count}
          href="/admin/ebay/review"
          ctaLabel={
            pendingSuggestions?.count
              ? `${pendingSuggestions.count} pending`
              : "Open review"
          }
        />
        <StepCard
          step="4"
          title="History"
          desc="See every change pushed to eBay, with the reasoning Claude gave at the time. Use this to audit results and undo if anything looks wrong."
          ready={!!appliedSuggestions?.count}
          href="/admin/ebay/history"
          ctaLabel={
            appliedSuggestions?.count
              ? `${appliedSuggestions.count} applied`
              : "Empty"
          }
        />
      </div>

      <div className="mt-10 pt-6 border-t border-brand-ink/10">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
          Phase 2 — Sales &amp; promotions
        </p>
        <Link
          href="/admin/ebay/sales"
          className="inline-block bg-white border border-brand-ink/15 hover:border-brand-yellow rounded-lg p-4 transition-colors"
        >
          <p className="font-medium mb-1">Sales &amp; promotions →</p>
          <p className="text-sm text-brand-ink/70">
            Schedule markdown sales, order discounts, and codeless vouchers.
            ROI reporting coming next.
          </p>
        </Link>
      </div>

      <p className="text-xs text-brand-ink/50 mt-12">
        Phase 3 (newsletters) is planned but not yet built.
      </p>
    </section>
  );
}

function ConnectionCard({ configured }: { configured: boolean }) {
  if (configured) {
    return (
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 flex items-center gap-4">
        <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-brand-yellow/30 text-brand-ink">
          Connected
        </span>
        <div className="text-sm text-brand-ink/70">
          eBay credentials are loaded from <code>.env.local</code>. Auth token
          rotation is manual — see{" "}
          <Link
            className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            href="/admin/ebay/connect"
          >
            connection settings
          </Link>
          .
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white border border-dashed border-brand-ink/30 rounded-lg p-5">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-brand-ink/10 text-brand-ink/70">
          Not connected
        </span>
        <p className="font-medium">
          Add your eBay credentials to <code>.env.local</code>.
        </p>
      </div>
      <p className="text-sm text-brand-ink/70 leading-relaxed">
        You need <code>EBAY_APP_ID</code>, <code>EBAY_DEV_ID</code>,{" "}
        <code>EBAY_CERT_ID</code>, and a long-lived <code>EBAY_AUTH_TOKEN</code>{" "}
        from the eBay developer portal. Step-by-step instructions live in{" "}
        <code>PHASE-EBAY-1-SETUP.md</code> in this repo.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
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

function StepCard({
  step,
  title,
  desc,
  ready,
  href,
  ctaLabel,
  hint,
}: {
  step: string;
  title: string;
  desc: string;
  ready: boolean;
  href: string;
  ctaLabel: string;
  hint?: string;
}) {
  const inner = (
    <div
      className={`bg-white border rounded-lg p-5 transition-colors ${
        ready
          ? "border-brand-ink/15 hover:border-brand-yellow"
          : "border-brand-ink/10 opacity-70"
      }`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <p className="font-marker text-base text-brand-ink/40">Step {step}</p>
        <span
          className={`text-xs uppercase tracking-wider px-2 py-1 rounded ${
            ready
              ? "bg-brand-yellow text-brand-ink"
              : "bg-brand-ink/10 text-brand-ink/60"
          }`}
        >
          {ready ? ctaLabel : "Locked"}
        </span>
      </div>
      <h3 className="font-medium text-lg mb-1">{title}</h3>
      <p className="text-sm text-brand-ink/70 leading-relaxed">{desc}</p>
      {hint && <p className="text-xs text-brand-ink/50 mt-2">{hint}</p>}
    </div>
  );

  if (!ready) return inner;
  return (
    <Link href={href} className="block">
      {inner}
    </Link>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
