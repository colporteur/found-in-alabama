// Server component that queries the items table for items linked to a
// given haul-post slug and renders them in two groups (active + sold)
// with a stats card above.

import { db, items as itemsTable } from "@/db";
import { and, eq, desc } from "drizzle-orm";

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
              <ActiveCard key={item.id} item={item} />
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
  heroImage: string | null;
  marketplaceUrls: unknown; // stored as jsonb, type-cast below
  soldAt: Date | string | null;
  soldOnMarketplace: string | null;
};

function getUrls(item: ItemRow): Record<string, string> {
  return (item.marketplaceUrls as Record<string, string>) ?? {};
}

function ActiveCard({ item }: { item: ItemRow }) {
  const urls = getUrls(item);
  return (
    <div className="border border-brand-ink/15 rounded-lg overflow-hidden bg-white">
      {item.heroImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.heroImage}
          alt=""
          className="w-full aspect-square object-cover"
        />
      )}
      <div className="p-3">
        <p className="text-sm font-medium mb-2 leading-tight line-clamp-3">
          {item.title}
        </p>
        <div className="flex flex-wrap gap-1">
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
  return (
    <div className="border border-brand-ink/10 rounded-lg overflow-hidden bg-white relative opacity-80">
      {item.heroImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.heroImage}
          alt=""
          className="w-full aspect-square object-cover grayscale"
        />
      )}
      <div className="absolute top-2 right-2 bg-emerald-700 text-white text-xs uppercase tracking-wider px-2 py-1 rounded">
        Sold
      </div>
      <div className="p-3">
        <p className="text-sm font-medium mb-1 leading-tight line-clamp-2 text-brand-ink/70">
          {item.title}
        </p>
        <p className="text-xs text-brand-ink/50">
          {soldOn ? `Sold on ${soldOn}` : "Sold"}
          {sold ? ` · ${sold}` : ""}
        </p>
      </div>
    </div>
  );
}
