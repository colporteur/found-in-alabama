// Server component that queries the items table for items linked to a
// given haul-post slug and renders them in two groups (active + sold)
// with a stats card above.

import Link from "next/link";
import { db, items as itemsTable } from "@/db";
import { eq, desc } from "drizzle-orm";
import {
  ebayListingIdFromUrl,
  getOnSaleLookup,
  type SaleBadge,
} from "@/lib/ebay/active-sales";

const MARKETPLACE_LABEL: Record<string, string> = {
  ebay: "eBay",
  etsy: "Etsy",
  poshmark: "Poshmark",
  mercari: "Mercari",
  depop: "Depop",
  whatnot: "Whatnot",
};

function formatSoldDate(iso: Date | string | null): string {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function HaulItemsFromDb({
  haulSlug,
}: {
  haulSlug: string;
}) {
  const rows = await db
    .select()
    .from(itemsTable)
    .where(eq(itemsTable.haulPostSlug, haulSlug))
    .orderBy(desc(itemsTable.capturedAt));

  if (rows.length === 0) return null;

  const active = rows.filter((r) => r.status !== "sold");
  const sold = rows.filter((r) => r.status === "sold");
  const total = rows.length;

  // Live sale badges: match by eBay listing id (tier sales) or store
  // category (monthly wizard sales).
  const onSale = await getOnSaleLookup();
  function badgeFor(row: (typeof rows)[number]): SaleBadge | null {
    const urls = (row.marketplaceUrls as Record<string, string>) ?? {};
    const listingId = ebayListingIdFromUrl(urls.ebay);
    if (listingId) {
      const b = onSale.byListingId.get(listingId);
      if (b) return b;
    }
    if (row.ebayStoreCategoryId) {
      const b = onSale.byCategoryId.get(row.ebayStoreCategoryId);
      if (b) return b;
    }
    return null;
  }

  return (
    <section className="mt-12 pt-8 border-t border-brand-ink/10">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        From this haul
      </p>

      {/* Stats card */}
      <div className="bg-brand-yellow/15 border border-brand-yellow rounded-lg p-4 mb-8 flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <p className="font-marker text-2xl leading-none">{total}</p>
          <p className="text-xs uppercase tracking-wider text-brand-ink/60 mt-1">
            items listed
          </p>
        </div>
        <div>
          <p className="font-marker text-2xl leading-none text-emerald-800">
            {sold.length}
          </p>
          <p className="text-xs uppercase tracking-wider text-brand-ink/60 mt-1">
            sold
          </p>
        </div>
        <div>
          <p className="font-marker text-2xl leading-none">{active.length}</p>
          <p className="text-xs uppercase tracking-wider text-brand-ink/60 mt-1">
            still available
          </p>
        </div>
      </div>

      {/* Active items */}
      {active.length > 0 && (
        <>
          <h2 className="font-marker text-2xl md:text-3xl mb-4">
            Still available
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            {active.map((item) => (
              <ActiveCard key={item.id} item={item} saleBadge={badgeFor(item)} />
            ))}
          </div>
        </>
      )}

      {/* Sold items */}
      {sold.length > 0 && (
        <>
          <h2 className="font-marker text-2xl md:text-3xl mb-4">
            Recently sold
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {sold.map((item) => (
              <SoldCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

type ItemRow = {
  id: string;
  title: string;
  slug: string | null;
  heroImage: string | null;
  price: string | null;
  marketplaceUrls: unknown; // stored as jsonb, type-cast below
  soldAt: Date | string | null;
  soldOnMarketplace: string | null;
};

/**
 * Build the URL for an item's product page. Falls back to the
 * UUID-based form for legacy rows without a slug — the next Chrome-
 * extension sync will backfill the slug column.
 */
function productHref(item: ItemRow): string {
  return item.slug ? `/products/${item.slug}` : `/products/${item.id}`;
}

function getUrls(item: ItemRow): Record<string, string> {
  return (item.marketplaceUrls as Record<string, string>) ?? {};
}

function formatPrice(p: string | null | undefined): string | null {
  if (!p) return null;
  const n = parseFloat(p);
  if (!Number.isFinite(n)) return null;
  return `$${n.toFixed(2)}`;
}

function saleEndsLabel(endsAt: Date): string {
  return endsAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ActiveCard({
  item,
  saleBadge,
}: {
  item: ItemRow;
  saleBadge: SaleBadge | null;
}) {
  const urls = getUrls(item);
  const price = formatPrice(item.price);
  const href = productHref(item);
  return (
    <div className="border border-brand-ink/15 rounded-lg overflow-hidden bg-white relative flex flex-col group">
      <Link href={href} className="block relative">
        {item.heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.heroImage}
            alt=""
            className="w-full aspect-square object-cover group-hover:opacity-90 transition-opacity"
          />
        ) : (
          <div className="w-full aspect-square bg-brand-paper border-b border-brand-ink/10 flex items-center justify-center">
            <span className="font-marker text-xl text-brand-ink/30 px-3 text-center leading-tight">
              {item.title.split(/\s+/).slice(0, 2).join(" ")}
            </span>
          </div>
        )}
        <span className="absolute top-2 right-2 bg-brand-yellow text-brand-ink text-xs uppercase tracking-wider font-medium px-2 py-1 rounded shadow-sm">
          Available
        </span>
        {saleBadge && (
          <span className="absolute top-2 left-2 bg-red-700 text-white text-xs uppercase tracking-wider font-medium px-2 py-1 rounded shadow-sm">
            {Math.round(saleBadge.discountPercent)}% off on eBay thru{" "}
            {saleEndsLabel(saleBadge.endsAt)}
          </span>
        )}
      </Link>
      <div className="p-3 flex-1 flex flex-col">
        <Link href={href} className="block group/title">
          <p className="text-sm font-medium mb-1 leading-tight line-clamp-3 group-hover/title:underline decoration-brand-yellow decoration-2 underline-offset-2">
            {item.title}
          </p>
        </Link>
        {price && (
          <p className="font-marker text-lg leading-none mb-2">{price}</p>
        )}
        <div className="flex flex-wrap gap-1 mt-auto">
          {Object.entries(urls).map(([key, url]) => (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2 py-1 bg-brand-yellow/30 hover:bg-brand-yellow text-brand-ink rounded transition-colors"
            >
              {MARKETPLACE_LABEL[key] ?? key}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function SoldCard({ item }: { item: ItemRow }) {
  const sold = formatSoldDate(item.soldAt);
  const soldOn = item.soldOnMarketplace
    ? MARKETPLACE_LABEL[item.soldOnMarketplace] ?? item.soldOnMarketplace
    : null;
  const price = formatPrice(item.price);
  const href = productHref(item);
  return (
    <div className="border border-brand-ink/10 rounded-lg overflow-hidden bg-white relative opacity-80 group">
      <Link href={href} className="block relative">
        {item.heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.heroImage}
            alt=""
            className="w-full aspect-square object-cover grayscale group-hover:opacity-90 transition-opacity"
          />
        ) : (
          // Fallback when Nifty stripped the picture URL post-sale.
          // Soft gray box with the marker-style "Sold" text in the middle.
          <div className="w-full aspect-square bg-brand-paper border-b border-brand-ink/10 flex items-center justify-center">
            <span className="font-marker text-2xl text-brand-ink/30">Sold</span>
          </div>
        )}
        <span className="absolute top-2 right-2 bg-emerald-700 text-white text-xs uppercase tracking-wider font-medium px-2 py-1 rounded shadow-sm">
          Sold
        </span>
      </Link>
      <div className="p-3">
        <Link href={href} className="block group/title">
          <p className="text-sm font-medium mb-1 leading-tight line-clamp-2 text-brand-ink/70 group-hover/title:underline decoration-brand-yellow decoration-2 underline-offset-2">
            {item.title}
          </p>
        </Link>
        {price && (
          <p className="font-marker text-base text-brand-ink/50 line-through leading-none mb-2">
            {price}
          </p>
        )}
        <p className="text-xs text-brand-ink/50">
          {soldOn ? `Sold on ${soldOn}` : "Sold"}
          {sold ? ` · ${sold}` : ""}
        </p>
      </div>
    </div>
  );
}
