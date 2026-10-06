// /alabama — every in-stock Alabama category in one place (Oct 2026).
// "Alabama" = categories flagged isAlabamaRelated in the categories admin,
// plus their descendants (lib/fia/home.ts). Linked from the home page's
// Alabama shelf; links back to all categories and to other states.

import type { Metadata } from "next";
import Link from "next/link";
import { getAlabamaCategories } from "@/lib/fia/home";
import { getStorefrontCategories } from "@/lib/ebay/storefront";

// ISR like the shop pages; lib/storefront-cache.ts purges it on demand.
export const revalidate = 600;

export const metadata: Metadata = {
  title: "Alabama — Shop",
  description:
    "Alabama history, places, people and memorabilia from Found in Alabama — every Alabama category in one place.",
};

export default async function AlabamaPage() {
  const [cats, all] = await Promise.all([
    getAlabamaCategories(),
    getStorefrontCategories({ segment: "fia" }),
  ]);
  const total = cats.reduce((n, c) => n + c.count, 0);

  // "Other states": the store's own "Found in Other States" shelf when it
  // has stock, otherwise The Ephemeral State's state-by-state index.
  const otherStates = all.find(
    (c) => /other states/i.test(c.name) && !c.parentCategoryId
  );
  const otherStatesHref = otherStates
    ? `/shop/${otherStates.slug}`
    : "https://theephemeralstate.com/states";

  return (
    <section className="container-content py-12">
      <Link href="/" className="text-sm text-brand-ink/60 hover:text-brand-ink">
        ← Home
      </Link>
      <p className="text-xs uppercase tracking-wider text-brand-earth mt-4 mb-3">
        Found in Alabama
      </p>
      <h1 className="font-marker text-4xl md:text-5xl leading-tight mb-3">
        Everything <span className="marker-highlight">Alabama.</span>
      </h1>
      <p className="text-brand-ink/75 max-w-prose mb-8">
        {total > 0
          ? `${total.toLocaleString()} pieces across ${cats.length} Alabama ${cats.length === 1 ? "category" : "categories"}.`
          : "Alabama inventory is syncing — check back shortly."}
      </p>

      {cats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 mb-12">
          {cats.map((c) => (
            <Link
              key={c.categoryId}
              href={`/shop/${c.slug}`}
              className="group bg-white rounded-xl overflow-hidden ring-1 ring-brand-ink/10 hover:ring-brand-yellow hover:shadow-lg transition-all duration-200"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-brand-paper">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.imageUrl}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="font-marker text-2xl text-brand-ink/25 px-3 text-center leading-tight">
                      {c.name}
                    </span>
                  </div>
                )}
                {(c.wholeCategoryOnSale || c.onSaleCount > 0) && (
                  <span className="absolute top-2 left-2 bg-red-700 text-white text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full shadow-sm">
                    {c.wholeCategoryOnSale ? "On sale" : `${c.onSaleCount} on sale`}
                  </span>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-semibold text-base leading-tight">{c.name}</h2>
                  <span className="text-xs text-brand-ink/45 whitespace-nowrap">
                    {c.count} items
                  </span>
                </div>
                {c.parentName && (
                  <p className="text-xs text-brand-ink/50 mt-1">in {c.parentName}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-t border-brand-ink/10 pt-8">
        <Link href="/shop" className="btn-primary">
          All categories →
        </Link>
        <a href={otherStatesHref} className="btn-secondary">
          Other states →
        </a>
      </div>
    </section>
  );
}
