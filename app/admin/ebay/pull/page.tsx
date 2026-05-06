// Step 2 of the eBay tool: pull active listings whose Store Category 1 is
// the "Other" bucket and whose Store Category 2 is empty. The actual fetch
// runs server-side in /api/admin/ebay/pull-listings; this page surfaces the
// cached results and a button to (re-)run the pull.

import Link from "next/link";
import { db } from "@/db";
import { ebayListings, ebayStoreCategories } from "@/db/schema";
import { count, desc, eq } from "drizzle-orm";
import PullListingsCard from "./PullListingsCard";

export const dynamic = "force-dynamic";

export interface CachedListing {
  itemId: string;
  sku: string | null;
  title: string;
  primaryImageUrl: string | null;
  price: string | null;
  quantity: number | null;
  siteCategoryName: string | null;
  lastSyncedAt: string;
}

export default async function PullListingsPage() {
  const [otherRow] = await db
    .select({
      categoryId: ebayStoreCategories.categoryId,
      name: ebayStoreCategories.name,
    })
    .from(ebayStoreCategories)
    .where(eq(ebayStoreCategories.isOtherBucket, true))
    .limit(1);

  const [{ count: total } = { count: 0 }] = await db
    .select({ count: count() })
    .from(ebayListings);

  // Show the 100 most recently synced listings on this page. We can paginate
  // later if the cache grows beyond that.
  const rows = await db
    .select({
      itemId: ebayListings.itemId,
      sku: ebayListings.sku,
      title: ebayListings.title,
      primaryImageUrl: ebayListings.primaryImageUrl,
      price: ebayListings.price,
      quantity: ebayListings.quantity,
      siteCategoryName: ebayListings.siteCategoryName,
      lastSyncedAt: ebayListings.lastSyncedAt,
    })
    .from(ebayListings)
    .orderBy(desc(ebayListings.lastSyncedAt))
    .limit(100);

  const sample: CachedListing[] = rows.map((r) => ({
    itemId: r.itemId,
    sku: r.sku,
    title: r.title,
    primaryImageUrl: r.primaryImageUrl,
    price: r.price,
    quantity: r.quantity,
    siteCategoryName: r.siteCategoryName,
    lastSyncedAt: r.lastSyncedAt.toISOString(),
  }));

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        eBay tools · Step 2
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">
        Pull listings to recategorize
      </h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Finds every active listing whose Store Category 1 is your &ldquo;Other&rdquo;
        bucket and whose Store Category 2 is empty. Cached locally so the
        review step in Step 3 can score and update them in batches.
      </p>

      <PullListingsCard
        otherCategory={otherRow ?? null}
        cachedTotal={total}
        sample={sample}
      />

      <div className="mt-10">
        <Link
          href="/admin/ebay"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Back to eBay tools
        </Link>
      </div>
    </section>
  );
}
