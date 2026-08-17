// Public product page. URL: /products/{slug}.
//
// One row per item in the inventory table. Shows hero image, price,
// available/sold banner, marketplace buttons (when active), and a link
// back to the haul story the item came from (when linked).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, items } from "@/db";
import { eq } from "drizzle-orm";
import { getPost } from "@/lib/posts";
import type { MarketplaceKey } from "@/db/schema";
import { resolveSimilarCategoryIdFast } from "@/lib/items/similar";
import {
  ebayStoreCategoryUrl,
  isEbayStoreConfigured,
} from "@/lib/ebay/store-url";
import SeeSimilarButton from "@/components/SeeSimilarButton";

// Refetch on every request so a fresh capture from the Chrome extension
// shows up immediately without a redeploy.
export const dynamic = "force-dynamic";

const MARKETPLACE_LABEL: Record<MarketplaceKey, string> = {
  ebay: "eBay",
  etsy: "Etsy",
  poshmark: "Poshmark",
  mercari: "Mercari",
  depop: "Depop",
  whatnot: "Whatnot",
};

const MARKETPLACE_ORDER: MarketplaceKey[] = [
  "ebay",
  "etsy",
  "poshmark",
  "mercari",
  "depop",
  "whatnot",
];

type Item = typeof items.$inferSelect;

// Match against slug first; fall back to UUID. The HaulItemsFromDb
// productHref helper uses UUID for legacy rows that don't have slugs
// yet, so both URL shapes must resolve.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadItem(idOrSlug: string): Promise<Item | null> {
  const [bySlug] = await db
    .select()
    .from(items)
    .where(eq(items.slug, idOrSlug))
    .limit(1);
  if (bySlug) return bySlug;
  if (UUID_RE.test(idOrSlug)) {
    const [byId] = await db
      .select()
      .from(items)
      .where(eq(items.id, idOrSlug))
      .limit(1);
    return byId ?? null;
  }
  return null;
}

function formatPrice(p: string | null): string | null {
  if (!p) return null;
  const n = parseFloat(p);
  if (!Number.isFinite(n)) return null;
  return `$${n.toFixed(2)}`;
}

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

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const item = await loadItem(params.slug);
  if (!item) return {};
  const price = formatPrice(item.price);
  const desc =
    item.status === "sold"
      ? `Sold${item.soldOnMarketplace ? ` on ${MARKETPLACE_LABEL[item.soldOnMarketplace as MarketplaceKey] ?? item.soldOnMarketplace}` : ""}.`
      : price
        ? `${price} — listed across our marketplaces. Found in Alabama.`
        : "Listed across our marketplaces. Found in Alabama.";
  return {
    title: item.title,
    description: desc,
    openGraph: {
      title: item.title,
      description: desc,
      images: item.heroImage ? [{ url: item.heroImage }] : [],
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: { slug: string };
}) {
  const item = await loadItem(params.slug);
  if (!item) notFound();

  const price = formatPrice(item.price);
  const isSold = item.status === "sold";
  const urls = (item.marketplaceUrls as Partial<Record<MarketplaceKey, string>>) ?? {};
  const activeMarketplaces = MARKETPLACE_ORDER.filter((k) => urls[k]);
  const haul = item.haulPostSlug ? getPost(item.haulPostSlug) : null;
  const soldDate = isSold ? formatSoldDate(item.soldAt) : "";
  const soldOnLabel =
    item.soldOnMarketplace
      ? MARKETPLACE_LABEL[item.soldOnMarketplace as MarketplaceKey] ??
        item.soldOnMarketplace
      : null;

  // "See similar items" — fast path only (cache + eBay listing join).
  // If we get a hit, render an instant link. If not, render a client
  // button that triggers the Haiku fallback on click (and caches it).
  const ebayConfigured = isEbayStoreConfigured();
  const fastCategoryId = ebayConfigured
    ? await resolveSimilarCategoryIdFast(item)
    : null;
  const fastSimilarUrl = fastCategoryId
    ? ebayStoreCategoryUrl(fastCategoryId)
    : null;

  return (
    <article className="container-content py-12">
      {/* Breadcrumb */}
      <nav className="text-sm mb-6 flex flex-wrap gap-x-2 items-center text-brand-ink/60">
        <Link href="/" className="hover:text-brand-ink">
          Home
        </Link>
        <span>·</span>
        {haul ? (
          <>
            <Link
              href={`/journal/${haul.slug}`}
              className="hover:text-brand-ink"
            >
              {haul.title}
            </Link>
            <span>·</span>
          </>
        ) : null}
        <span className="text-brand-ink/80">{item.title}</span>
      </nav>

      <div className="grid gap-8 md:grid-cols-2 max-w-5xl">
        {/* Image column */}
        <div>
          {item.heroImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.heroImage}
              alt={item.title}
              className={`w-full aspect-square object-cover rounded-lg border border-brand-ink/10 ${
                isSold ? "grayscale" : ""
              }`}
            />
          ) : (
            <div className="w-full aspect-square bg-brand-paper border border-brand-ink/10 rounded-lg flex items-center justify-center">
              <span className="font-marker text-3xl text-brand-ink/30 px-6 text-center leading-tight">
                {item.title.split(/\s+/).slice(0, 3).join(" ")}
              </span>
            </div>
          )}
        </div>

        {/* Detail column */}
        <div className="flex flex-col">
          {/* Status banner */}
          <div className="mb-3">
            {isSold ? (
              <span className="inline-block bg-emerald-700 text-white text-xs uppercase tracking-wider font-medium px-2.5 py-1 rounded">
                Sold
              </span>
            ) : (
              <span className="inline-block bg-brand-yellow text-brand-ink text-xs uppercase tracking-wider font-medium px-2.5 py-1 rounded">
                Available
              </span>
            )}
          </div>

          <h1 className="font-marker text-3xl md:text-4xl leading-tight mb-3">
            {item.title}
          </h1>

          {price && (
            <p
              className={`font-marker text-3xl mb-6 ${isSold ? "text-brand-ink/40 line-through" : ""}`}
            >
              {price}
            </p>
          )}

          {/* Active marketplaces — only show when available */}
          {!isSold && activeMarketplaces.length > 0 && (
            <div className="mb-8">
              <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
                Available on
              </p>
              <div className="grid grid-cols-2 gap-2">
                {activeMarketplaces.map((k) => (
                  <a
                    key={k}
                    href={urls[k]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-3 bg-brand-yellow/20 hover:bg-brand-yellow text-brand-ink text-sm font-medium rounded-md text-center transition-colors border border-brand-ink/10"
                  >
                    {MARKETPLACE_LABEL[k]} →
                  </a>
                ))}
              </div>
            </div>
          )}

          {!isSold && activeMarketplaces.length === 0 && (
            <p className="text-sm text-brand-ink/60 italic mb-8">
              Listing links aren&rsquo;t recorded yet — check back soon or
              reach out and we&rsquo;ll point you at the right marketplace.
            </p>
          )}

          {/* Sold-state info */}
          {isSold && (
            <div className="mb-8 p-4 border border-brand-ink/10 bg-brand-paper rounded-lg">
              <p className="text-sm text-brand-ink/80">
                {soldOnLabel ? (
                  <>
                    Sold on <span className="font-medium">{soldOnLabel}</span>
                  </>
                ) : (
                  "Sold"
                )}
                {soldDate ? ` · ${soldDate}` : ""}
              </p>
              {haul && (
                <p className="text-sm text-brand-ink/70 mt-2">
                  More from this haul is still available — see the{" "}
                  <Link
                    href={`/journal/${haul.slug}`}
                    className="underline decoration-brand-yellow decoration-2 underline-offset-2 hover:text-brand-ink"
                  >
                    {haul.title}
                  </Link>{" "}
                  story.
                </p>
              )}
            </div>
          )}

          {/* See similar items — opens the seller's eBay store category */}
          {ebayConfigured && (
            <div className="mb-8">
              <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
                Looking for more like this?
              </p>
              {fastSimilarUrl ? (
                <a
                  href={fastSimilarUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 bg-transparent text-brand-ink border border-brand-ink/30 text-sm font-medium rounded-md hover:bg-brand-ink/5 transition-colors"
                >
                  See similar items →
                </a>
              ) : (
                <SeeSimilarButton slug={item.slug ?? item.id} />
              )}
            </div>
          )}

          {/* Haul backlink */}
          {haul && !isSold && (
            <div className="border-t border-brand-ink/10 pt-6 mt-auto">
              <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
                From the haul
              </p>
              <Link
                href={`/journal/${haul.slug}`}
                className="block group"
              >
                <p className="font-marker text-xl text-brand-ink group-hover:underline decoration-brand-yellow decoration-2 underline-offset-4">
                  {haul.title} →
                </p>
                {haul.excerpt && (
                  <p className="text-sm text-brand-ink/70 mt-1 leading-relaxed">
                    {haul.excerpt}
                  </p>
                )}
              </Link>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
