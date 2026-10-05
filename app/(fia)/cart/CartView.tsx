"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCart } from "@/components/tes/CartProvider";

const fmt = (n: number) => `$${n.toFixed(2)}`;

type Quote = {
  subtotal: number;
  shipping: number;
  free: boolean;
  serviceLabel: string;
  weightOz: number;
  freeAt: number;
  remainingForFree: number;
};

type QuoteResponse = {
  ok: boolean;
  error?: string;
  unavailable?: string[];
  lines?: { itemId: string; unitPrice: number; quantity: number }[];
  quote?: Quote;
};

export default function CartView() {
  const { lines, remove, setQuantity, ready } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const seq = useRef(0);

  const key = lines.map((l) => `${l.itemId}:${l.quantity}`).join(",");

  // Re-quote whenever the cart changes (server prices + shipping).
  useEffect(() => {
    if (!ready) return;
    if (lines.length === 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const mine = ++seq.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/fia/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
          }),
        });
        const json = (await res.json()) as QuoteResponse;
        if (mine !== seq.current) return;
        if (json.ok && json.quote) {
          setQuote(json.quote);
          setPrices(new Map((json.lines ?? []).map((l) => [l.itemId, l.unitPrice])));
          setQuoteError(null);
        } else {
          setQuote(null);
          if (json.unavailable?.length) {
            for (const id of json.unavailable) remove(id);
          }
          setQuoteError(json.error ?? "Couldn't price this cart.");
        }
      } catch {
        if (mine === seq.current) setQuoteError("Couldn't price this cart — try again.");
      } finally {
        if (mine === seq.current) setQuoting(false);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  async function startCheckout() {
    setCheckingOut(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/fia/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        }),
      });
      const json = (await res.json()) as {
        url?: string;
        error?: string;
        unavailable?: string[];
      };
      if (res.ok && json.url) {
        window.location.href = json.url;
        return;
      }
      if (json.unavailable?.length) {
        for (const id of json.unavailable) remove(id);
      }
      setCheckoutError(json.error ?? "Checkout failed — please try again.");
    } catch {
      setCheckoutError("Checkout failed — please try again.");
    } finally {
      setCheckingOut(false);
    }
  }

  return (
    <section className="container-content py-12">
      <Link href="/shop" className="text-sm text-brand-ink/60 hover:text-brand-ink">
        ← Keep shopping
      </Link>
      <h1 className="font-marker text-3xl md:text-5xl leading-tight mt-3 mb-8">
        Your cart
      </h1>

      {!ready ? null : lines.length === 0 ? (
        <div className="bg-white rounded-xl ring-1 ring-brand-ink/10 p-12 text-center">
          <p className="font-marker text-2xl text-brand-ink/40 mb-1">Nothing here yet.</p>
          <p className="text-sm text-brand-ink/60">
            Find something you like in the{" "}
            <Link href="/shop" className="underline underline-offset-2">
              shop
            </Link>{" "}
            and it&rsquo;ll wait for you here.
          </p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] items-start">
          <ul className="space-y-3">
            {lines.map((l) => {
              const unit = prices.get(l.itemId) ?? l.price;
              return (
                <li
                  key={l.itemId}
                  className="flex gap-4 bg-white rounded-lg ring-1 ring-brand-ink/10 p-3"
                >
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.imageUrl} alt="" className="w-20 h-20 object-cover rounded" />
                  ) : (
                    <div className="w-20 h-20 rounded bg-brand-paper" />
                  )}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/item/${l.itemId}`}
                      className="text-sm font-medium leading-tight line-clamp-2 hover:underline"
                    >
                      {l.title}
                    </Link>
                    <div className="flex items-center gap-3 mt-2">
                      <div className="inline-flex items-center rounded border border-brand-ink/15">
                        <button
                          type="button"
                          onClick={() => setQuantity(l.itemId, l.quantity - 1)}
                          className="px-2 py-0.5 text-sm hover:bg-brand-paper"
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className="px-2 text-sm tabular-nums">{l.quantity}</span>
                        <button
                          type="button"
                          onClick={() => setQuantity(l.itemId, l.quantity + 1)}
                          className="px-2 py-0.5 text-sm hover:bg-brand-paper"
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(l.itemId)}
                        className="text-xs text-brand-ink/50 hover:text-red-700 underline underline-offset-2"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <p className="font-marker text-lg whitespace-nowrap">
                    {fmt(unit * l.quantity)}
                  </p>
                </li>
              );
            })}
          </ul>

          <aside className="bg-white rounded-xl ring-1 ring-brand-ink/10 p-5 space-y-3 lg:sticky lg:top-6">
            {quote ? (
              <>
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{fmt(quote.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>
                    Shipping
                    <span className="block text-xs text-brand-ink/50">
                      {quote.serviceLabel} · {(quote.weightOz / 16).toFixed(1)} lb
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {quote.free ? (
                      <span className="text-green-700 font-medium">Free</span>
                    ) : (
                      fmt(quote.shipping)
                    )}
                  </span>
                </div>
                {!quote.free && quote.remainingForFree > 0 && (
                  <p className="text-xs bg-brand-yellow/20 rounded px-3 py-2">
                    Add {fmt(quote.remainingForFree)} more and shipping is free.
                  </p>
                )}
                <div className="border-t border-brand-ink/10 pt-3 flex justify-between font-medium">
                  <span>Total</span>
                  <span className="font-marker text-xl tabular-nums">
                    {fmt(quote.subtotal + quote.shipping)}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-brand-ink/60">
                {quoting ? "Calculating shipping…" : quoteError ?? ""}
              </p>
            )}
            {quote && quoteError && (
              <p className="text-xs bg-amber-50 text-amber-900 rounded px-3 py-2">{quoteError}</p>
            )}
            {checkoutError && (
              <p className="text-xs bg-red-50 text-red-800 rounded px-3 py-2">{checkoutError}</p>
            )}
            <button
              type="button"
              onClick={startCheckout}
              disabled={checkingOut || quoting || !quote}
              className="w-full px-4 py-3 rounded-md bg-brand-ink text-white font-medium hover:bg-brand-ink/85 transition-colors disabled:opacity-50"
            >
              {checkingOut ? "Preparing checkout…" : "Checkout"}
            </button>
            <p className="text-[11px] text-brand-ink/45 leading-snug">
              Secure payment by Stripe. We re-check availability at
              checkout — our pieces are also listed on other marketplaces
              and occasionally sell there first.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}
