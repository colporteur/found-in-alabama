// One product card on the storefront. Image, title, price (with a
// struck-through original + discount banner when on sale), and a link
// out to the live eBay listing.

import type { StorefrontItem } from "@/lib/ebay/storefront";

function formatPrice(p: string | null): string | null {
  if (!p) return null;
  const n = parseFloat(p);
  if (!Number.isFinite(n)) return null;
  return `$${n.toFixed(2)}`;
}

function salePrice(p: string | null, pct: number): string | null {
  if (!p) return null;
  const n = parseFloat(p);
  if (!Number.isFinite(n)) return null;
  return `$${(n * (1 - pct / 100)).toFixed(2)}`;
}

function endsLabel(endsAt: Date): string {
  return new Date(endsAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function StorefrontItemCard({ item }: { item: StorefrontItem }) {
  const price = formatPrice(item.price);
  const sale = item.sale;
  const discounted = sale ? salePrice(item.price, sale.discountPercent) : null;

  return (
    <a
      href={item.ebayUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group block border border-brand-ink/15 rounded-lg overflow-hidden bg-white hover:border-brand-yellow transition-colors flex flex-col"
    >
      <div className="relative">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            className="w-full aspect-square object-cover group-hover:opacity-90 transition-opacity"
          />
        ) : (
          <div className="w-full aspect-square bg-brand-paper border-b border-brand-ink/10 flex items-center justify-center">
            <span className="font-marker text-lg text-brand-ink/30 px-3 text-center leading-tight">
              {item.title.split(/\s+/).slice(0, 2).join(" ")}
            </span>
          </div>
        )}
        {sale && (
          <span className="absolute top-2 left-2 bg-red-700 text-white text-xs uppercase tracking-wider font-medium px-2 py-1 rounded shadow-sm">
            {Math.round(sale.discountPercent)}% off thru {endsLabel(sale.endsAt)}
          </span>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <p className="text-sm font-medium leading-tight line-clamp-3 mb-2 group-hover:underline decoration-brand-yellow decoration-2 underline-offset-2">
          {item.title}
        </p>
        <div className="mt-auto flex items-baseline gap-2">
          {discounted ? (
            <>
              <span className="font-marker text-lg leading-none text-red-700">
                {discounted}
              </span>
              {price && (
                <span className="text-sm text-brand-ink/50 line-through">
                  {price}
                </span>
              )}
            </>
          ) : (
            price && (
              <span className="font-marker text-lg leading-none">{price}</span>
            )
          )}
        </div>
      </div>
    </a>
  );
}
