// Store category sync + Alabama/Other tagging UI. Server component pulls the
// current snapshot from Postgres; the actual sync action and per-row toggles
// are handled by client components that POST/PATCH to API routes.

import Link from "next/link";
import { db } from "@/db";
import { ebayStoreCategories } from "@/db/schema";
import { asc, sql } from "drizzle-orm";
import { makeCounter } from "@/lib/shop/invoice-pitch";
import CategoriesEditor from "./CategoriesEditor";

export const dynamic = "force-dynamic";

export interface StoredCategory {
  categoryId: string;
  parentCategoryId: string | null;
  name: string;
  order: number;
  isAlabamaRelated: boolean;
  isOtherBucket: boolean;
  isEphemeralState: boolean;
  shipClass: string;
  /** Invoice stock line wording / count level (COUPON-2). */
  invoiceLabel: string | null;
  invoiceCountLevel: string;
  /** In-stock items in this category and its subcategories. */
  inStock: number;
  lastSyncedAt: string;
}

export default async function CategoriesPage() {
  const rows = await db
    .select()
    .from(ebayStoreCategories)
    .orderBy(asc(ebayStoreCategories.parentCategoryId), asc(ebayStoreCategories.order));

  // In-stock counts per category subtree (what the invoice stock line uses).
  const items = ((await db.execute(sql`SELECT store_category_1_id AS c1, store_category_2_id AS c2 FROM ebay_listings WHERE quantity > 0`)) as {
    rows?: Array<{ c1: string | null; c2: string | null }>;
  }).rows ?? [];
  const counter = makeCounter(
    rows.map((r) => ({
      categoryId: r.categoryId,
      parentCategoryId: r.parentCategoryId,
      name: r.name,
      isEphemeralState: r.isEphemeralState,
      invoiceLabel: null,
      invoiceCountLevel: "self" as const,
    })),
    items.map((i) => ({ cats: [i.c1, i.c2].filter((x): x is string => !!x) })),
    "fia",
    new Set()
  );
  // Serialize Date → ISO string for the client component.
  const serialized: StoredCategory[] = rows.map((r) => ({
    categoryId: r.categoryId,
    parentCategoryId: r.parentCategoryId,
    name: r.name,
    order: r.order,
    isAlabamaRelated: r.isAlabamaRelated,
    isOtherBucket: r.isOtherBucket,
    isEphemeralState: r.isEphemeralState,
    shipClass: r.shipClass,
    invoiceLabel: r.invoiceLabel ?? null,
    invoiceCountLevel: r.invoiceCountLevel ?? "self",
    inStock: counter.of(r.categoryId),
    lastSyncedAt: r.lastSyncedAt.toISOString(),
  }));

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        eBay tools · Step 1
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">
        Store categories
      </h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Pulls your full Store category tree from eBay and lets you mark
        which ones count as Alabama-related (those will get priority during
        re-categorization), which one is the &ldquo;Other&rdquo; bucket
        (the source we&rsquo;ll move listings out of), and which belong to
        The Ephemeral State storefront (flag a parent and its children ride
        along). Re-running sync is safe — it preserves your manual flag
        edits.
      </p>

      <CategoriesEditor initial={serialized} />

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
