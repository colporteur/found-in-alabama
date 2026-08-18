// TES product detail page — /item/[itemId] on the TES domain. Gallery,
// price (with sale), the eBay listing description (sanitized), shipping
// blurb from the schedule, add-to-cart, and Product JSON-LD for SEO.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTesItemDetail } from "@/lib/tes/item-detail";
import { sanitizeListingHtml, plainTextFromHtml } from "@/lib/tes/sanitize";
import { SHIP_SCHEDULE } from "@/lib/tes/shipping";
import { tesHome } from "@/lib/tes/host";
import AddToCartButton from "@/components/tes/AddToCartButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const fmt = (n: number) => `$${n.toFixed(2)}`;

export async function generateMetadata({
  params,
}: {
  params: { itemId: string };
}): Promise<Metadata> {
  const item = await getTesItemDetail(params.itemId);
  if (!item) return { title: "Not found" };
  const description = item.descriptionHtml
    ? plainTextFromHtml(item.descriptionHtml, 160)
    : `${item.title} — antique paper Americana from The Ephemeral State.`;
  return {
    title: item.title,
    description,
    alternates: { canonical: `/item/${item.itemId}` },
    openGraph: {
      title: item.title,
      description,
      ...(item.images[0] ? { images: [{ url: item.images[0] }] } : {}),
    },
  };
}

export default async function TesItemPage({
  params,
}: {
  params: { itemId: string };
}) {
  const item = await getTesItemDetail(params.itemId);
  if (!item) notFound();

  const sched = SHIP_SCHEDULE[item.shipClass];
  const effective = item.salePrice ?? item.price;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.title,
    ...(item.images.length > 0 ? { image: item.images } : {}),
    ...(item.sku ? { sku: item.sku } : {}),
    description: item.descriptionHtml
      ? plainTextFromHtml(item.descriptionHtml, 500)
      : item.title,
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: effective.toFixed(2),
      availability: "https://schema.org/InStock",
      url: `https://theephemeralstate.com/item/${item.itemId}`,
    },
  };

  return (
    <section className="container-content py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Link
        href={tesHome()}
        className="text-sm text-tes-ink/60 hover:text-tes-ink"
      >
        ← All categories
      </Link>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px] items-start mt-4">
        {/* Gallery */}
        <div>
          {item.images.length === 0 ? (
            <div className="aspect-square bg-white rounded-xl ring-1 ring-tes-ink/10 flex items-center justify-center">
              <span className="font-typewriter text-2xl text-tes-ink/30">
                No photo
              </span>
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.images[0]}
                alt={item.title}
                className="w-full rounded-xl ring-1 ring-tes-ink/10 bg-white"
              />
              {item.images.length > 1 && (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-2">
                  {item.images.slice(1).map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open full size"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        className="aspect-square object-cover rounded-lg ring-1 ring-tes-ink/10 bg-white hover:ring-tes-kraft"
                      />
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Buy box */}
        <aside className="bg-white rounded-xl ring-1 ring-tes-ink/10 p-6 space-y-4 lg:sticky lg:top-6">
          <h1 className="font-typewriter text-2xl leading-snug">
            {item.title}
          </h1>
          <div className="flex items-baseline gap-3">
            <span className="font-typewriter text-3xl">
              {fmt(effective)}
            </span>
            {item.salePrice != null && (
              <>
                <span className="text-tes-ink/50 line-through">
                  {fmt(item.price)}
                </span>
                <span className="text-sm text-red-700 font-medium">
                  {Math.round(item.discountPercent ?? 0)}% off
                </span>
              </>
            )}
          </div>
          <AddToCartButton
            itemId={item.itemId}
            title={item.title}
            price={effective}
            imageUrl={item.images[0] ?? null}
            shipClass={item.shipClass}
          />
          <p className="text-sm text-tes-ink/65 leading-snug">
            Ships as {sched.label.toLowerCase()}: {fmt(sched.first)} for the
            first item, +{fmt(sched.additional)} each additional — free on
            orders over ${sched.freeAt}.
          </p>
          {item.quantity > 1 && (
            <p className="text-xs text-tes-ink/50">
              {item.quantity} available.
            </p>
          )}
          <p className="text-xs text-tes-ink/45">
            Prefer eBay?{" "}
            <a
              href={item.ebayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-tes-ink"
            >
              This piece is also listed there ↗
            </a>
          </p>
        </aside>
      </div>

      {/* Description */}
      {item.descriptionHtml && (
        <div className="mt-10 max-w-3xl">
          <h2 className="font-typewriter text-2xl mb-4">About this piece</h2>
          <div
            className="bg-white rounded-xl ring-1 ring-tes-ink/10 p-6 overflow-x-auto font-typewriter text-[15px] text-tes-ink/85 leading-relaxed space-y-2 [&_p]:mb-3 [&_img]:max-w-full [&_img]:h-auto [&_table]:max-w-full [&_a]:underline [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base"
            dangerouslySetInnerHTML={{
              __html: sanitizeListingHtml(item.descriptionHtml),
            }}
          />
        </div>
      )}
    </section>
  );
}
