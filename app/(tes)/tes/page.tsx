// The Ephemeral State home — hero + browse by category. Shows only the
// categories flagged isEphemeralState (plus their descendants) via the
// "tes" storefront segment. Category cards mirror the FIA /shop layout,
// restyled for the kraft-paper palette.

import type { Metadata } from "next";
import Link from "next/link";
import {
  getStorefrontCategoryTree,
  type StorefrontCategory,
  type StorefrontCategoryGroup,
} from "@/lib/ebay/storefront";
import { tesPrefix } from "@/lib/tes/host";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "The Ephemeral State — Antique paper Americana, state by state",
  description:
    "Browse postcards, photographs, documents, and other paper survivors by state and by kind. Every piece links straight to its eBay listing.",
  // Canonical always points at the real domain, so the /tes preview path
  // on foundinalabama.com never competes in search.
  alternates: { canonical: "/" },
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
    <div className="relative aspect-[4/3] overflow-hidden bg-tes-cream">
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
          <span className="font-typewriter text-2xl text-tes-ink/25 px-3 text-center leading-tight">
            {cat.name}
          </span>
        </div>
      )}
      <SaleBadge cat={cat} />
    </div>
  );
}

function CategoryCard({
  group,
  prefix,
}: {
  group: StorefrontCategoryGroup;
  prefix: string;
}) {
  const linkable = group.count > 0;
  const CardBody = (
    <>
      <CategoryThumb cat={group} />
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold text-base leading-tight tracking-tight group-hover:text-tes-kraft-dark transition-colors">
            {group.name}
          </h2>
          <span className="text-xs text-tes-ink/45 whitespace-nowrap shrink-0">
            {group.count > 0 ? `${group.count} items` : ""}
          </span>
        </div>
      </div>
    </>
  );

  return (
    <div className="group bg-white rounded-xl overflow-hidden ring-1 ring-tes-ink/10 hover:ring-tes-kraft hover:shadow-lg transition-all duration-200 flex flex-col">
      {linkable ? (
        <Link href={`${prefix}/shop/${group.slug}`} className="block">
          {CardBody}
        </Link>
      ) : (
        <div>{CardBody}</div>
      )}

      {group.children.length > 0 && (
        <div className="px-4 pb-4 -mt-1">
          <div className="flex flex-wrap gap-1.5">
            {group.children.map((child) => (
              <Link
                key={child.categoryId}
                href={`${prefix}/shop/${child.slug}`}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-tes-cream hover:bg-tes-kraft/30 text-tes-ink/75 hover:text-tes-ink transition-colors"
              >
                {child.name}
                {(child.wholeCategoryOnSale || child.onSaleCount > 0) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
                )}
                <span className="text-tes-ink/40">{child.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default async function TesHomePage() {
  const prefix = tesPrefix();
  const groups = await getStorefrontCategoryTree({ segment: "tes" });
  const totalItems = groups.reduce(
    (sum, g) => sum + g.count + g.children.reduce((s, c) => s + c.count, 0),
    0
  );

  return (
    <>
      <section className="border-b border-tes-ink/10 bg-tes-kraft/15">
        <div className="container-content py-14 md:py-20">
          <p className="text-xs uppercase tracking-[0.2em] text-tes-stamp mb-4">
            Antique paper Americana
          </p>
          <h1 className="font-typewriter text-4xl md:text-6xl leading-tight mb-5 max-w-3xl">
            Paper survivors, sorted by the state they came from.
          </h1>
          <p className="text-lg text-tes-ink/75 max-w-prose leading-relaxed">
            Postcards, photographs, letters, documents, and other ephemera —
            the paper that outlived its errand. Browse by state or by kind;
            every piece checks out on eBay.
          </p>
        </div>
      </section>

      <section className="container-content py-12">
        <div className="flex items-baseline justify-between gap-3 mb-8">
          <h2 className="font-typewriter text-2xl md:text-3xl">
            Browse the collection
          </h2>
          <p className="text-sm text-tes-ink/55">
            {totalItems > 0
              ? `${totalItems.toLocaleString()} pieces in stock`
              : ""}
          </p>
        </div>

        {groups.length === 0 ? (
          <div className="bg-white rounded-xl ring-1 ring-tes-ink/10 p-12 text-center">
            <p className="font-typewriter text-2xl text-tes-ink/40 mb-1">
              The cases are being filled.
            </p>
            <p className="text-sm text-tes-ink/60">
              Categories appear here once they&rsquo;re flagged for The
              Ephemeral State and stocked.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {groups.map((group) => (
              <CategoryCard
                key={group.categoryId}
                group={group}
                prefix={prefix}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
