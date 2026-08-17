"use client";

import Link from "next/link";
import { useCart } from "@/components/tes/CartProvider";
import {
  quoteShipping,
  SHIP_SCHEDULE,
  type CartShipInput,
} from "@/lib/tes/shipping";

const fmt = (n: number) => `$${n.toFixed(2)}`;

export default function CartView({ home }: { home: string }) {
  const { lines, remove, setQuantity, ready } = useCart();

  const quote = quoteShipping(
    lines.map(
      (l): CartShipInput => ({
        shipClass: l.shipClass,
        quantity: l.quantity,
        price: l.price,
      })
    )
  );

  return (
    <section className="container-content py-12">
      <Link href={home} className="text-sm text-tes-ink/60 hover:text-tes-ink">
        ← Keep browsing
      </Link>
      <h1 className="font-typewriter text-3xl md:text-5xl leading-tight mt-3 mb-8">
        Your cart
      </h1>

      {!ready ? null : lines.length === 0 ? (
        <div className="bg-white rounded-xl ring-1 ring-tes-ink/10 p-12 text-center">
          <p className="font-typewriter text-2xl text-tes-ink/40 mb-1">
            Nothing here yet.
          </p>
          <p className="text-sm text-tes-ink/60">
            Add a few paper survivors and they&rsquo;ll wait for you here.
          </p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] items-start">
          <ul className="space-y-3">
            {lines.map((l) => (
              <li
                key={l.itemId}
                className="flex gap-4 bg-white rounded-lg ring-1 ring-tes-ink/10 p-3"
              >
                {l.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.imageUrl}
                    alt=""
                    className="w-20 h-20 object-cover rounded"
                  />
                ) : (
                  <div className="w-20 h-20 rounded bg-tes-cream" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight line-clamp-2">
                    {l.title}
                  </p>
                  <p className="text-xs text-tes-ink/50 mt-1">
                    {SHIP_SCHEDULE[l.shipClass].label}
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="inline-flex items-center rounded border border-tes-ink/15">
                      <button
                        type="button"
                        onClick={() => setQuantity(l.itemId, l.quantity - 1)}
                        className="px-2 py-0.5 text-sm hover:bg-tes-cream"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="px-2 text-sm tabular-nums">
                        {l.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuantity(l.itemId, l.quantity + 1)}
                        className="px-2 py-0.5 text-sm hover:bg-tes-cream"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(l.itemId)}
                      className="text-xs text-tes-ink/50 hover:text-red-700 underline underline-offset-2"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <p className="font-typewriter text-lg whitespace-nowrap">
                  {fmt(l.price * l.quantity)}
                </p>
              </li>
            ))}
          </ul>

          <aside className="bg-white rounded-xl ring-1 ring-tes-ink/10 p-5 space-y-3 lg:sticky lg:top-6">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span className="tabular-nums">{fmt(quote.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Shipping</span>
              <span className="tabular-nums">
                {quote.free ? (
                  <span className="text-green-700 font-medium">Free</span>
                ) : (
                  fmt(quote.shipping)
                )}
              </span>
            </div>
            {!quote.free && quote.remainingForFree > 0 && (
              <p className="text-xs bg-tes-kraft/15 text-tes-ink rounded px-3 py-2">
                Add {fmt(quote.remainingForFree)} more and shipping is free.
              </p>
            )}
            <div className="border-t border-tes-ink/10 pt-3 flex justify-between font-medium">
              <span>Total</span>
              <span className="font-typewriter text-xl tabular-nums">
                {fmt(quote.subtotal + quote.shipping)}
              </span>
            </div>
            <button
              type="button"
              disabled
              title="Checkout opens soon"
              className="w-full px-4 py-3 rounded-md bg-tes-ink text-tes-cream font-medium opacity-50 cursor-not-allowed"
            >
              Checkout — opening soon
            </button>
            <p className="text-[11px] text-tes-ink/45 leading-snug">
              Until checkout opens, every item&rsquo;s card links to its eBay
              listing where you can buy today.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}
