// eBay tools dashboard. As of Phase eBay-1.1 this is a thin entry point:
// connection status, the auto-categorize tool, and the sales (Phase 2)
// section. The old per-step review/pull pages have been replaced by the
// one-button auto-categorize flow.

import Link from "next/link";
import { db } from "@/db";
import { ebayStoreCategories } from "@/db/schema";
import { count, eq } from "drizzle-orm";
import { getLatestRun } from "@/lib/ebay/auto-categorize";

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
  const [otherCat] = await db
    .select({
      categoryId: ebayStoreCategories.categoryId,
      name: ebayStoreCategories.name,
    })
    .from(ebayStoreCategories)
    .where(eq(ebayStoreCategories.isOtherBucket, true))
    .limit(1);

  const latestRun = await getLatestRun();

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        eBay tools
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">
        Manage your store
      </h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Two tools wired up to your eBay seller account: auto-categorize cleans
        up the &ldquo;Other&rdquo; bucket using Claude, and sales/promotions
        (Phase 2) schedules markdowns. Both depend on the Store category sync,
        which you should run any time you add or rename Store categories.
      </p>

      <ConnectionCard configured={credsConfigured} />

      <div className="grid gap-4 sm:grid-cols-3 my-8">
        <Stat
          label="Store categories"
          value={catTotal?.count ?? 0}
          hint={catTotal?.count ? "Synced" : "Not synced yet"}
        />
        <Stat
          label="Alabama-flagged"
          value={catAlabama?.count ?? 0}
          hint="Used as priority targets"
        />
        <Stat
          label={"“Other” bucket"}
          value={otherCat ? 1 : 0}
          hint={otherCat?.name ?? "Auto-detected on sync"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 max-w-3xl">
        <ToolCard
          href="/admin/ebay/categories"
          title="Sync Store categories"
          desc="Pull your full Store category tree from eBay and flag the Alabama-related ones. Re-run any time you add or rename categories on eBay."
          ready={credsConfigured}
          cta={catTotal?.count ? "Edit flags" : "Run sync"}
        />
        <ToolCard
          href="/admin/ebay/auto-categorize"
          title="Auto-categorize"
          desc='One-button Claude-powered re-categorization of listings stuck in "Other." Pushes changes to eBay immediately. Phase 2 adds a 2nd category to items that still need one.'
          ready={credsConfigured && !!otherCat}
          cta={
            latestRun?.status === "running"
              ? "Run in progress →"
              : latestRun
              ? "Open"
              : "Get started"
          }
        />
      </div>

      <div className="mt-10 pt-6 border-t border-brand-ink/10">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
          Phase 2 — Sales &amp; promotions
        </p>
        <Link
          href="/admin/ebay/sales"
          className="inline-block bg-white border border-brand-ink/15 hover:border-brand-yellow rounded-lg p-4 transition-colors max-w-md"
        >
          <p className="font-medium mb-1">Sales &amp; promotions →</p>
          <p className="text-sm text-brand-ink/70">
            Schedule markdown sales, order discounts, and codeless vouchers.
            (eBay&rsquo;s Marketing API currently returns errors — Seller Hub
            UI works fine in the meantime.)
          </p>
        </Link>
      </div>

      <div className="mt-10 pt-6 border-t border-brand-ink/10">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
          Expert Enhance
        </p>
        <Link
          href="/admin/ebay/enhance"
          className="inline-block bg-white border border-brand-ink/15 hover:border-brand-yellow rounded-lg p-4 transition-colors max-w-md"
        >
          <p className="font-medium mb-1">Expert Enhance portal →</p>
          <p className="text-sm text-brand-ink/70">
            Batch listing improvements via ReviseItem — price bumps, SKU
            renames, guide-informed remixes. Phase 0 (queue + cost
            dashboard) is live.
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
          eBay credentials loaded from <code>.env.local</code>. Auth token
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

function ToolCard({
  title,
  desc,
  ready,
  href,
  cta,
}: {
  title: string;
  desc: string;
  ready: boolean;
  href: string;
  cta: string;
}) {
  const inner = (
    <div
      className={`bg-white border rounded-lg p-5 h-full transition-colors ${
        ready
          ? "border-brand-ink/15 hover:border-brand-yellow"
          : "border-brand-ink/10 opacity-70"
      }`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-medium text-lg">{title}</h3>
        <span
          className={`text-xs uppercase tracking-wider px-2 py-1 rounded ${
            ready
              ? "bg-brand-yellow text-brand-ink"
              : "bg-brand-ink/10 text-brand-ink/60"
          }`}
        >
          {ready ? cta : "Locked"}
        </span>
      </div>
      <p className="text-sm text-brand-ink/70 leading-relaxed">{desc}</p>
    </div>
  );

  if (!ready) return inner;
  return (
    <Link href={href} className="block">
      {inner}
    </Link>
  );
}
