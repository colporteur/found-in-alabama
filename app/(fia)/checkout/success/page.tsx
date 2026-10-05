// foundinalabama.com thank-you page (Phase FIA-SHOP-1). Stripe redirects
// here after payment; ClearCart (shared with TES) empties the cart.

import type { Metadata } from "next";
import Link from "next/link";
import ClearCart from "@/app/(tes)/tes/checkout/success/ClearCart";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order received",
  robots: { index: false },
};

export default function FiaCheckoutSuccessPage() {
  return (
    <section className="container-content py-20 text-center max-w-2xl">
      <ClearCart />
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-4">
        Order received
      </p>
      <h1 className="font-marker text-4xl md:text-5xl leading-tight mb-5">
        Thank you — it&rsquo;s headed for the packing table.
      </h1>
      <p className="text-lg text-brand-ink/75 leading-relaxed mb-3">
        A receipt is on its way to your email. Most orders ship from
        Lineville within one business day, and you&rsquo;ll get tracking
        when the label prints.
      </p>
      <p className="text-sm text-brand-ink/55 mb-10">
        Questions about your order? Text us at 256-684-1253.
      </p>
      <Link href="/shop" className="btn-primary">
        Keep shopping →
      </Link>
    </section>
  );
}
