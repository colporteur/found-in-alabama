// FIA product page — /item/[itemId] on foundinalabama.com (Phase
// FIA-SHOP-1). Buy here with Stripe, or follow the links to the same item
// on eBay and the other marketplaces. Items over the weight/size cap
// (lib/fia/shipping directSaleCheck) are eBay-only: no Add to cart.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFiaItemDetail } from "@/lib/fia/item-detail";
import { sanitizeListingHtml, plainTextFromHtml } from "@/lib/tes/sanitize";
import { largeEbayImage } from "@/lib/tes/images";
import { serviceLabel } from "@/lib/fia/shipping";
import ItemGallery from "@/components/tes/ItemGallery";
import FiaAddToCartButton from "@/components/fia/FiaAddToCartButton";

// ISR, same as the shop grid (lib/storefront-cache.ts purges on sales,
// reprices and ended listings). Never read headers()/cookies() here.
export const revalidate = 600;

const fmt = (n: number) => `$${n.toFixed(2)}`;

export async function generateMetadata({
  params,
}: {
  params: { itemId: string };
}): Promise<Metadata> {
  const item = await getFiaItemDetail(params.itemId);
  if (!item) return { title: "Not found" };
  const description = item.descriptionHtml
    ? plainTextFromHtml(item.descriptionHtml, 160)
    : `${item.title} — from Found in Alabama.`;
  return {
    title: item.title,
    description,
    alternates: { canonical: `/item/${item.itemId}` },
    openGraph: {
      title: item.title,
      description,
      ...(item.images[0] ? { images: [{ url: largeEbayImage(item.images[0]) }] } : {}),
    },
  };
}

export default async function FiaItemPage({
  params,
}: {
  params: { itemId: string };
}) {
  const item = await getFiaItemDetail(params.itemId);
  if (!item) notFound();

  const est = item.shippingEstimate;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.title,
    ...(item.images.length > 0 ? { image: item.images.map(largeEbayImage) } : {}),
    ...(item.sku ? { sku: item.sku } : {}),
    description: item.descriptionHtml
      ? plainTextFromHtml(item.descriptionHtml, 500)
      : item.title,
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: item.price.toFixed(2),
      availability: "https://schema.org/InStock",
      url: `https://www.foundinalabama.com/item/${item.itemId}`,
    },
  };

  const elsewhere = [{ label: "eBay", url: item.ebayUrl }, ...item.otherMarketplaces];

  return (
    <section className="container-content py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Link href="/shop" className="text-sm text-brand-ink/60 hover:text-brand-ink">
        ← Shop all categories
      </Link>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px] items-start mt-4">
        <ItemGallery images={item.images} title={item.title} theme="fia" />

        <aside className="bg-white rounded-xl ring-1 ring-brand-ink/10 p-6 space-y-4 lg:sticky lg:top-6">
          <h1 className="font-marker text-2xl leading-snug">{item.title}</h1>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-marker text-3xl">{fmt(item.price)}</span>
            {item.discountPercent > 0 && (
              <>
                <span className="text-brand-ink/50 line-through">
                  {fmt(item.listPrice)}
                </span>
                <span className="text-sm text-red-700 font-medium">
                  {Math.round(item.discountPercent)}% off
                  {item.saleEndsAt
                    ? ` thru ${new Date(item.saleEndsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : " buying direct"}
                </span>
              </>
            )}
          </div>

          {item.directSale ? (
            <>
              <FiaAddToCartButton
                itemId={item.itemId}
                title={item.title}
                price={item.price}
                imageUrl={item.images[0] ?? null}
                shipClass={item.ship.shipClass}
                maxQuantity={item.quantity}
              />
              {est.ok && (
                <p className="text-sm text-brand-ink/70 leading-snug">
                  {est.free ? (
                    <>Ships free by {serviceLabel(est.service)}.</>
                  ) : (
                    <>
                      Ships by {serviceLabel(est.service)} for{" "}
                      <strong>{fmt(est.shipping)}</strong>
                      {item.ship.weightOz == null ? " (estimated)" : ""}.
                    </>
                  )}{" "}
                  Combined shipping on multiple items.
                  {item.settings.freeAt > 0 && !est.free && (
                    <> Free on orders of {fmt(item.settings.freeAt)}+.</>
                  )}
                </p>
              )}
              <p className="text-xs text-brand-ink/50 leading-snug">
                Secure checkout by Stripe. Ships from Lineville, Alabama,
                usually within one business day.
              </p>
            </>
          ) : (
            <div className="rounded-md bg-brand-paper border border-brand-ink/10 p-4 text-sm leading-snug">
              <p className="mb-3">
                This piece is too {item.directSaleReason === "too_big" ? "large" : "heavy"}{" "}
                to ship from our site — buy it on eBay, where shipping is
                calculated for your address.
              </p>
              <a
                href={item.ebayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center px-4 py-3 rounded-md bg-brand-ink text-white font-medium hover:bg-brand-ink/85"
              >
                Buy on eBay →
              </a>
            </div>
          )}

          {item.quantity > 1 && (
            <p className="text-xs text-brand-ink/50">{item.quantity} available.</p>
          )}

          <div className="border-t border-brand-ink/10 pt-4">
            <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
              {item.directSale ? "Prefer a marketplace? Also on" : "Also on"}
            </p>
            <div className="flex flex-wrap gap-2">
              {elsewhere.map((m) => (
                <a
                  key={m.label}
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm px-3 py-1.5 rounded-md bg-brand-paper hover:bg-brand-yellow/30 border border-brand-ink/10"
                >
                  {m.label} ↗
                </a>
              ))}
            </div>
          </div>

          {item.haulSlug && (
            <Link
              href={`/journal/${item.haulSlug}`}
              className="block text-sm text-brand-earth hover:text-brand-ink"
            >
              Read about how we found this →
            </Link>
          )}
        </aside>
      </div>

      {item.descriptionHtml && (
        <div className="mt-10 max-w-3xl">
          <h2 className="font-marker text-2xl mb-4">About this piece</h2>
          <div
            className="bg-white rounded-xl ring-1 ring-brand-ink/10 p-6 overflow-x-auto text-[15px] text-brand-ink/85 leading-relaxed space-y-2 [&_p]:mb-3 [&_img]:max-w-full [&_img]:h-auto [&_table]:max-w-full [&_a]:underline [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base"
            dangerouslySetInnerHTML={{
              __html: sanitizeListingHtml(item.descriptionHtml),
            }}
          />
        </div>
      )}
    </section>
  );
}
