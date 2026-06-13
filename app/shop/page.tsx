// Storefront index — browse the eBay store by category, grouped into
// parent/child sections. Counts and live-sale indicators come from the
// local listings mirror + active sales.

import type { Metadata } from "next";
import Link from "next/link";
import {
  getStorefrontCategoryTree,
  type StorefrontCategory,
} from "@/lib/ebay/storefront";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shop the inventory",
  description:
    "Browse Found in Alabama's estate finds, vintage, books, ephemera, and small antiques by category. Every item links straight to its eBay listing.",
};

function SaleNote({ cat }: { cat: StorefrontCategory }) {
  if (cat.wholeCategoryOnSale) {
    return (
      <span className="inline-block mt-1 text-xs font-medium text-red-700">
        Entire category on sale now
      </span>
    );
  }
  if (cat.onSaleCount > 0) {
    return (
      <span className="inline-block mt-1 text-xs font-medium text-red-700">
        {cat.onSaleCount} {cat.onSaleCount === 1 ? "item" : "items"} on sale now
      </span>
    );
  }
  return null;
}

export default async function ShopIndexPage() {
  const groups = await getStorefrontCategoryTree();
  const totalItems = groups.reduce(
    (sum, g) => sum + g.count + g.children.reduce((s, c) => s + c.count, 0),
    0
  );

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
          ? `${totalItems.toLocaleString()} pieces across the shelves. Pick a category to dig through — every item links straight to its eBay listing.`
          : "Inventory is syncing — check back shortly."}
      </p>

      {groups.length === 0 ? (
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
          {groups.map((group) => (
            <div
              key={group.categoryId}
              className="border border-brand-ink/15 rounded-lg p-5 bg-white"
            >
              {group.count > 0 ? (
                <Link
                  href={`/shop/${group.slug}`}
                  className="group/cat block hover:text-brand-yellow-dark transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-sans font-semibold text-lg leading-tight tracking-tight">
                      {group.name}
                    </span>
                    <span className="text-sm text-brand-ink/55 whitespace-nowrap">
                      {group.count} →
                    </span>
                  </div>
                  <SaleNote cat={group} />
                </Link>
              ) : (
                <span className="font-sans font-semibold text-lg leading-tight tracking-tight text-brand-ink/70">
                  {group.name}
                </span>
              )}

              {group.isNewArrivals && (
                <p className="text-sm text-brand-ink/55 mt-1">
                  Freshly listed, not yet sorted.
                </p>
              )}

              {group.children.length > 0 && (
                <ul className="mt-3 pt-3 border-t border-brand-ink/10 space-y-1.5">
                  {group.children.map((child) => (
                    <li key={child.categoryId}>
                      <Link
                        href={`/shop/${child.slug}`}
                        className="flex items-baseline justify-between gap-3 text-sm text-brand-ink/80 hover:text-brand-yellow-dark transition-colors"
                      >
                        <span>
                          {child.name}
                          {(child.wholeCategoryOnSale ||
                            child.onSaleCount > 0) && (
                            <span className="ml-2 text-xs font-medium text-red-700">
                              {child.wholeCategoryOnSale
                                ? "· on sale"
                                : `· ${child.onSaleCount} on sale`}
                            </span>
                          )}
                        </span>
                        <span className="text-brand-ink/45 whitespace-nowrap">
                          {child.count}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
