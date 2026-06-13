// Storefront index — browse the eBay store by category. Image-led
// category cards grouped into parent/child sections, with live-sale
// badges. Data from the local listings mirror + active sales.

import type { Metadata } from "next";
import Link from "next/link";
import {
  getStorefrontCategoryTree,
  type StorefrontCategory,
  type StorefrontCategoryGroup,
} from "@/lib/ebay/storefront";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shop the inventory",
  description:
    "Browse Found in Alabama's estate finds, vintage, books, ephemera, and small antiques by category. Every item links straight to its eBay listing.",
};

function SaleBadge({ cat }: { cat: StorefrontCategory }) {
  if (cat.wholeCategoryOnSale) {
    return (
      <span className="absolute top-2 left-2 bg-red-700 text-white text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full shadow-sm">
        On sale
      </span>
    );
  }
  if (cat.onSaleCount > 0) {
    return (
      <span className="absolute top-2 left-2 bg-red-700 text-white text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full shadow-sm">
        {cat.onSaleCount} on sale
      </span>
    );
  }
  return null;
}

function CategoryThumb({ cat }: { cat: StorefrontCategory }) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden bg-brand-paper">
      {cat.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cat.imageUrl}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <span className="font-marker text-2xl text-brand-ink/25 px-3 text-center leading-tight">
            {cat.name}
          </span>
        </div>
      )}
      <SaleBadge cat={cat} />
    </div>
  );
}

function CategoryCard({ group }: { group: StorefrontCategoryGroup }) {
  const linkable = group.count > 0;
  const Header = (
    <>
      <CategoryThumb cat={group} />
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold text-base leading-tight tracking-tight group-hover:text-brand-yellow-dark transition-colors">
            {group.name}
          </h2>
          <span className="text-xs text-brand-ink/45 whitespace-nowrap shrink-0">
            {group.count > 0 ? `${group.count} items` : ""}
          </span>
        </div>
        {group.isNewArrivals && (
          <p className="text-xs text-brand-ink/50 mt-1">
            Freshly listed, not yet sorted.
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="group bg-white rounded-xl overflow-hidden ring-1 ring-brand-ink/10 hover:ring-brand-yellow hover:shadow-lg transition-all duration-200 flex flex-col">
      {linkable ? (
        <Link href={`/shop/${group.slug}`} className="block">
          {Header}
        </Link>
      ) : (
        <div>{Header}</div>
      )}

      {group.children.length > 0 && (
        <div className="px-4 pb-4 -mt-1">
          <div className="flex flex-wrap gap-1.5">
            {group.children.map((child) => (
              <Link
                key={child.categoryId}
                href={`/shop/${child.slug}`}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-brand-paper hover:bg-brand-yellow/30 text-brand-ink/75 hover:text-brand-ink transition-colors"
              >
                {child.name}
                {(child.wholeCategoryOnSale || child.onSaleCount > 0) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
                )}
                <span className="text-brand-ink/40">{child.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default async function ShopIndexPage() {
  const groups = await getStorefrontCategoryTree();
  const totalItems = groups.reduce(
    (sum, g) => sum + g.count + g.children.reduce((s, c) => s + c.count, 0),
    0
  );
  const onSaleSomewhere = groups.some(
    (g) =>
      g.wholeCategoryOnSale ||
      g.onSaleCount > 0 ||
      g.children.some((c) => c.wholeCategoryOnSale || c.onSaleCount > 0)
  );

  return (
    <section className="container-content py-16">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        Shop the inventory
      </p>
      <h1 className="font-marker text-4xl md:text-6xl leading-tight mb-4">
        Browse by <span className="marker-highlight">category.</span>
      </h1>
      <p className="text-lg text-brand-ink/75 max-w-prose leading-relaxed mb-2">
        {totalItems > 0
          ? `${totalItems.toLocaleString()} pieces across the shelves — every item links straight to its eBay listing.`
          : "Inventory is syncing — check back shortly."}
      </p>
      {onSaleSomewhere && (
        <p className="inline-flex items-center gap-2 text-sm font-medium text-red-700 mb-8">
          <span className="w-2 h-2 rounded-full bg-red-600" />
          Sales running now — look for the red badges.
        </p>
      )}
      {!onSaleSomewhere && <div className="mb-8" />}

      {groups.length === 0 ? (
        <div className="bg-white rounded-xl ring-1 ring-brand-ink/10 p-12 text-center">
          <p className="font-marker text-2xl text-brand-ink/40 mb-1">
            Nothing to show yet.
          </p>
          <p className="text-sm text-brand-ink/60">
            The storefront populates after the first inventory sync.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {groups.map((group) => (
            <CategoryCard key={group.categoryId} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}
