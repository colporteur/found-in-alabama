// Admin dashboard — a grouped launcher for every tool in the admin.
// The top nav carries the daily drivers; this page makes sure nothing
// we've built is more than one click away.

import { auth } from "@/auth";
import { db, items } from "@/db";
import { count, eq } from "drizzle-orm";
import Link from "next/link";

export default async function AdminDashboard() {
  const session = await auth();

  const [activeRow] = await db
    .select({ count: count() })
    .from(items)
    .where(eq(items.status, "active"));
  const [soldRow] = await db
    .select({ count: count() })
    .from(items)
    .where(eq(items.status, "sold"));

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        Welcome back
      </p>
      <h1 className="font-marker text-4xl md:text-5xl mb-8">
        Hi, {session?.user?.email?.split("@")[0]}.
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 max-w-md mb-12">
        <Stat label="Active inventory" value={activeRow?.count ?? 0} />
        <Stat label="Sold" value={soldRow?.count ?? 0} />
      </div>

      <Group title="Journal & content">
        <Tool
          href="/admin/draft"
          title="Draft a haul"
          desc="Photos + typed or spoken story → Claude writes the journal post."
        />
        <Tool
          href="/admin/drafts"
          title="Saved drafts"
          desc="Hauls captured but not yet generated or published."
        />
        <Tool
          href="/admin/journal"
          title="Published posts"
          desc="Edit haul posts that are already live on the site."
        />
      </Group>

      <Group title="eBay store">
        <Tool
          href="/admin/ebay/workbench"
          title="Workbench"
          desc="Every listing with SKU classes and last-action dates. Check items, apply wiggles or substantive changes."
        />
        <Tool
          href="/admin/ebay/enhance"
          title="Expert Enhance"
          desc="Batch dashboard: create batches by filter, watch the queue, track AI spend."
        />
        <Tool
          href="/admin/ebay/enhance/history"
          title="Change history & rollback"
          desc="Every mutation the pipeline made, with per-item, per-batch, and 24h rollback."
        />
        <Tool
          href="/admin/ebay/auto-categorize"
          title="Auto-categorize"
          desc='One-button Claude re-categorization of listings stuck in "Other."'
        />
        <Tool
          href="/admin/ebay/categories"
          title="Store categories"
          desc="Sync the category tree from eBay and flag Alabama-related ones."
        />
        <Tool
          href="/admin/ebay/sales"
          title="Sales & promotions"
          desc="Markdown sales, order discounts, and vouchers."
        />
        <Tool
          href="/admin/ebay/connect"
          title="eBay connection"
          desc="API credentials and token status."
        />
      </Group>

      <Group title="Marketing">
        <Tool
          href="/admin/social"
          title="Social copy"
          desc="Generate per-channel posts for hauls, items, and sales."
        />
        <Tool
          href="/admin/social/queue"
          title="Social queue"
          desc="Scheduled, posted, and failed drafts across all channels."
        />
        <Tool
          href="/admin/settings/posting"
          title="Posting connections"
          desc="BlueSky, Pinterest, and Publer account status."
        />
        <Tool
          href="/admin/newsletter"
          title="Newsletter subscribers"
          desc="Signup list, confirmations, and CSV export."
        />
        <Tool
          href="/admin/newsletter/drafts"
          title="Newsletter drafts"
          desc="Generate, edit, and send the monthly newsletter."
        />
      </Group>

      <Group title="Data & setup">
        <Tool
          href="/admin/inventory"
          title="Inventory browser"
          desc="Nifty-captured items across all six marketplaces."
        />
        <Tool
          href="/admin/ai-models"
          title="AI Models"
          desc="Gateway routing table: which model each alias and app uses. Swap models with no deploy."
        />
        <Tool
          href="/admin/api-keys"
          title="API keys"
          desc="Keys for the Chrome extension's inventory capture."
        />
      </Group>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
        {label}
      </p>
      <p className="font-marker text-3xl">{value.toLocaleString()}</p>
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-10">
      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function Tool({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="block bg-white border border-brand-ink/15 hover:border-brand-yellow rounded-lg p-4 transition-colors"
    >
      <p className="font-medium mb-1">{title} →</p>
      <p className="text-sm text-brand-ink/70 leading-relaxed">{desc}</p>
    </Link>
  );
}
