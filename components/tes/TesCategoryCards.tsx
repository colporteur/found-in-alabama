// Shared category-card rendering for The Ephemeral State browse pages
// (home, /states, /types). Extracted from the original home page.

import Link from "next/link";
import type {
  StorefrontCategory,
  StorefrontCategoryGroup,
} from "@/lib/ebay/storefront";

export function SaleBadge({ cat }: { cat: StorefrontCategory }) {
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

export function CategoryThumb({ cat }: { cat: StorefrontCategory }) {
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

export function CategoryCard({
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
          <h3 className="font-semibold text-base leading-tight tracking-tight group-hover:text-tes-kraft-dark transition-colors">
            {group.name}
          </h3>
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

export function CategoryGrid({
  groups,
  prefix,
}: {
  groups: StorefrontCategoryGroup[];
  prefix: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
      {groups.map((group) => (
        <CategoryCard key={group.categoryId} group={group} prefix={prefix} />
      ))}
    </div>
  );
}
