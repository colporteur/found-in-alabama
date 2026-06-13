// Storefront index — browse the eBay store by category. Each category
// links to its item grid; counts come from the local listings mirror.

import type { Metadata } from "next";
import Link from "next/link";
import { getStorefrontCategories } from "@/lib/ebay/storefront";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shop the inventory",
  description:
    "Browse Found in Alabama's estate finds, vintage, books, ephemera, and small antiques by category. Every item links straight to its eBay listing.",
};

export default async function ShopIndexPage() {
  const categories = await getStorefrontCategories();
  const totalItems = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <section className="container-content py-16">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        Shop the inventory
      </p>
      <h1 className="font-marker text-4xl md:text-6xl leading-tight mb-6">
        Browse by <span className="marker-highlight">category.</span>
      </h1>
      <p className="text-lg text-brand-ink/80 max-w-prose leading-relaxed mb-10">
        {totalItems > 0
          ? `${totalItems.toLocaleString()} pieces across ${categories.length} categories. Pick a shelf to dig through — every item links straight to its eBay listing.`
          : "Inventory is syncing — check back shortly."}
      </p>

      {categories.length === 0 ? (
        <div className="bg-white border border-dashed border-brand-ink/20 rounded-lg p-12 text-center">
          <p className="font-marker text-2xl text-brand-ink/40 mb-1">
            Nothing to show yet.
          </p>
          <p className="text-sm text-brand-ink/60">
            The storefront populates after the first inventory sync.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <Link
              key={cat.categoryId}
              href={`/shop/${cat.slug}`}
              className="group block border border-brand-ink/15 rounded-lg p-5 hover:border-brand-yellow hover:bg-brand-yellow/10 transition-colors"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-marker text-2xl leading-tight">{cat.name}</p>
                <span className="text-sm text-brand-ink/60 group-hover:text-brand-ink transition-colors whitespace-nowrap">
                  {cat.count} →
                </span>
              </div>
              {cat.isNewArrivals && (
                <p className="text-sm text-brand-ink/60 mt-1">
                  Freshly listed, not yet sorted into a category.
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
