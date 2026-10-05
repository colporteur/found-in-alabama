// One category's item grid. Items open their on-site product page (buy
// direct, Phase FIA-SHOP-1, or follow links to eBay and the other
// marketplaces); discounted items show a banner and struck-through price.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCategoryItems,
  resolveCategorySlug,
} from "@/lib/ebay/storefront";
import StorefrontItemCard from "@/components/StorefrontItemCard";
import { getFiaDiscountPercent } from "@/lib/fia/settings";

// ISR: served from the cache for STOREFRONT_REVALIDATE_SECONDS (see
// lib/storefront-cache.ts); sold/ended/repriced items and category
// changes purge it on demand. Crawlers hit the CDN, not a function.
export const revalidate = 600;

export async function generateMetadata({
  params,
}: {
  params: { category: string };
}): Promise<Metadata> {
  const cat = await resolveCategorySlug(params.category);
  if (!cat) return { title: "Category not found" };
  return {
    title: `${cat.name} — Shop`,
    description: `Browse ${cat.count} ${cat.name.toLowerCase()} pieces from Found in Alabama. Buy direct, or on eBay and our other marketplaces.`,
  };
}

export default async function ShopCategoryPage({
  params,
}: {
  params: { category: string };
}) {
  const category = await resolveCategorySlug(params.category);
  if (!category) notFound();

  const [items, flatPct] = await Promise.all([
    getCategoryItems(category),
    getFiaDiscountPercent(),
  ]);

  return (
    <section className="container-content py-12">
      <Link
        href="/shop"
        className="text-sm text-brand-ink/60 hover:text-brand-ink"
      >
        ← All categories
      </Link>
      <h1 className="font-marker text-3xl md:text-5xl leading-tight mt-3 mb-2">
        {category.name}
      </h1>
      <p className="text-brand-ink/70 mb-8">
        {category.count} {category.count === 1 ? "piece" : "pieces"}
        {category.isNewArrivals
          ? " — freshly listed and not yet sorted into a category."
          : "."}
      </p>

      {items.length === 0 ? (
        <p className="text-brand-ink/60 italic">
          Nothing in stock here right now.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((item) => (
            <StorefrontItemCard key={item.itemId} item={item} flatPct={flatPct} />
          ))}
        </div>
      )}
    </section>
  );
}
