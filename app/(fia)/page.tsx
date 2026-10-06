import Link from "next/link";
import { marketplaces, contact } from "@/lib/links";
import StorefrontItemCard from "@/components/StorefrontItemCard";
import { getHomeShelves } from "@/lib/fia/home";
import { getFiaDiscountPercent } from "@/lib/fia/settings";

// ISR (10 min), purged on demand with the rest of the storefront
// (lib/storefront-cache.ts revalidates "/"), so sold items drop quickly.
export const revalidate = 600;

export default async function HomePage() {
  const [{ alabamaCategories, alabamaItems, alabamaTotal, topCategories }, flatPct] =
    await Promise.all([getHomeShelves(), getFiaDiscountPercent()]);
  return (
    <>
      {/* Hero — compact, so the Alabama shelf sits high */}
      <section className="container-content pt-8 pb-6 md:pt-10 md:pb-8">
        <h1 className="font-marker text-3xl md:text-4xl leading-tight mb-3">
          Estate finds, books, and small antiques —{" "}
          <span className="marker-highlight">found in Alabama.</span>
        </h1>
        <p className="text-base md:text-lg text-brand-ink/75 leading-snug mb-5 max-w-2xl">
          If you collect it, we sell it. Come check out what we&rsquo;ve found.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/shop" className="btn-primary">
            Shop the inventory →
          </Link>
          <Link href="/we-buy" className="btn-secondary">
            We buy estates &amp; collections
          </Link>
        </div>
      </section>

      {/* Found in Alabama — the Alabama inventory, front and center.
          (The journal is still in the header menu; it came off the home
          page in Oct 2026 for lack of evidence it drives sales.) */}
      {(alabamaItems.length > 0 || alabamaCategories.length > 0) && (
        <section className="container-content pt-6 pb-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
                Found in Alabama
              </p>
              <h2 className="font-marker text-3xl md:text-4xl">
                Alabama history, people &amp; places.
              </h2>
              {alabamaTotal > 0 && (
                <p className="text-sm text-brand-ink/60 mt-2">
                  {alabamaTotal.toLocaleString()} Alabama pieces on the shelves.
                </p>
              )}
            </div>
          </div>

          {alabamaCategories.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-8">
              {alabamaCategories.map((c) => (
                <Link
                  key={c.categoryId}
                  href={`/shop/${c.slug}`}
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-white ring-1 ring-brand-ink/10 hover:ring-brand-yellow hover:bg-brand-yellow/20 transition-colors"
                >
                  {c.name}
                  <span className="text-brand-ink/45">{c.count}</span>
                </Link>
              ))}
            </div>
          )}

          {alabamaItems.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {alabamaItems.map((item) => (
                <StorefrontItemCard key={item.itemId} item={item} flatPct={flatPct} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Top non-ephemera categories (ephemera has its own site). */}
      {topCategories.length > 0 && (
        <section className="container-content pt-2 pb-16">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
                Shop by category
              </p>
              <h2 className="font-marker text-3xl md:text-4xl">
                Our deepest shelves.
              </h2>
            </div>
            <Link
              href="/shop"
              className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
            >
              All categories →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {topCategories.map((c) => (
              <Link
                key={c.categoryId}
                href={`/shop/${c.slug}`}
                className="group bg-white rounded-xl overflow-hidden ring-1 ring-brand-ink/10 hover:ring-brand-yellow hover:shadow-lg transition-all duration-200"
              >
                <div className="aspect-[4/3] overflow-hidden bg-brand-paper">
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
                </div>
                <div className="p-4 flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-base leading-tight">
                    {c.name}
                  </h3>
                  <span className="text-xs text-brand-ink/45 whitespace-nowrap">
                    {c.count} items
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Marketplaces strip */}
      <section className="bg-white border-y border-brand-ink/10">
        <div className="container-content py-16">
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
            Where to find them
          </p>
          <h2 className="font-marker text-3xl md:text-4xl mb-8">
            Find our hauls here.
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {marketplaces.map((m) => (
              <a
                key={m.name}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block border border-brand-ink/15 rounded-lg p-4 hover:border-brand-yellow hover:bg-brand-yellow/10 transition-colors"
              >
                <p className="font-medium text-base">{m.name}</p>
                <p className="text-xs text-brand-ink/60 mt-1">{m.handle}</p>
              </a>
            ))}
          </div>
          <p className="text-sm text-brand-ink/60 mt-6">
            See all of our profiles on the{" "}
            <Link
              href="/find-me"
              className="underline decoration-brand-yellow decoration-2 underline-offset-4"
            >
              Find me
            </Link>{" "}
            page.
          </p>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-brand-yellow">
        <div className="container-content py-14 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="font-marker text-3xl md:text-4xl mb-2">
              Got an estate or collection?
            </h2>
            <p className="text-brand-ink/80">
              Text us. We answer fast and we travel statewide.
            </p>
          </div>
          <a
            href={contact.smsHref}
            className="inline-flex items-center justify-center px-7 py-4 bg-brand-ink text-brand-paper font-medium rounded-md hover:bg-brand-ink/90 transition-colors text-lg"
          >
            Text {contact.phone} →
          </a>
        </div>
      </section>
    </>
  );
}
