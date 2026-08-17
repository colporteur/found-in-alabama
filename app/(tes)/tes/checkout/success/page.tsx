// Post-checkout thank-you page. Stripe redirects here after payment;
// the ClearCart client component empties the localStorage cart.

import type { Metadata } from "next";
import Link from "next/link";
import { tesHome } from "@/lib/tes/host";
import ClearCart from "./ClearCart";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order received",
  robots: { index: false },
};

export default function CheckoutSuccessPage() {
  return (
    <section className="container-content py-20 text-center max-w-2xl">
      <ClearCart />
      <p className="text-xs uppercase tracking-[0.2em] text-tes-stamp mb-4">
        Postmarked
      </p>
      <h1 className="font-typewriter text-4xl md:text-5xl leading-tight mb-5">
        Your order is on its way to the mailroom.
      </h1>
      <p className="text-lg text-tes-ink/75 leading-relaxed mb-3">
        Thank you — a receipt is headed to your email. Paper survivors are
        packed flat and carefully; most orders ship within one business
        day.
      </p>
      <p className="text-sm text-tes-ink/55 mb-10">
        Questions about your order? Text us at 256-684-1253.
      </p>
      <Link
        href={tesHome()}
        className="inline-block px-6 py-3 rounded-md bg-tes-ink text-tes-cream font-medium hover:bg-tes-ink/85 transition-colors"
      >
        Keep browsing the states →
      </Link>
    </section>
  );
}
