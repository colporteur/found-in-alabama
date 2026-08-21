// Returns & refunds policy — a plain-language static page. Exists partly
// for buyers and partly because Google Merchant Center requires a
// returns-policy URL on the domain before it approves free listings.

import type { Metadata } from "next";
import Link from "next/link";
import { tesHome } from "@/lib/tes/host";

export const metadata: Metadata = {
  title: "Returns & refunds",
  description:
    "Return policy for The Ephemeral State: 30-day returns on every item, refunded in full to your original payment method.",
  alternates: { canonical: "/returns" },
};

export default function TesReturnsPage() {
  return (
    <section className="container-content py-12">
      <Link href={tesHome()} className="text-sm text-tes-ink/60 hover:text-tes-ink">
        ← Home
      </Link>
      <h1 className="font-typewriter text-3xl md:text-5xl leading-tight mt-3 mb-2">
        Returns &amp; refunds
      </h1>
      <p className="text-tes-ink/70 mb-10 max-w-prose">
        Every piece we sell is an original paper survivor, photographed
        honestly and described carefully. If one arrives and it isn&rsquo;t
        right for you, here&rsquo;s how returns work.
      </p>

      <div className="max-w-prose space-y-8 text-tes-ink/90 leading-relaxed">
        <div>
          <h2 className="font-typewriter text-xl mb-2">30-day returns</h2>
          <p>
            You may return any item within 30 days of delivery, for any
            reason. Just contact us first so we know it&rsquo;s coming, then
            send the item back in the same condition it arrived in &mdash;
            these are antique paper items, so please pack them flat and
            protected, the same way we shipped them to you.
          </p>
        </div>

        <div>
          <h2 className="font-typewriter text-xl mb-2">Refunds</h2>
          <p>
            Once the item arrives back to us, we refund the full purchase
            price to your original payment method, normally within 3
            business days. If an item arrives damaged or isn&rsquo;t as
            described, tell us right away &mdash; we&rsquo;ll make it right,
            including covering the return postage.
          </p>
        </div>

        <div>
          <h2 className="font-typewriter text-xl mb-2">Return shipping</h2>
          <p>
            For a change-of-mind return, the buyer pays return postage. For
            anything that was our mistake &mdash; damage in transit, an
            error in the description &mdash; we pay it.
          </p>
        </div>

        <div>
          <h2 className="font-typewriter text-xl mb-2">How to start a return</h2>
          <p>
            Email{" "}
            <a
              href="mailto:todd@theephemeralstate.com"
              className="text-tes-kraft-dark underline underline-offset-2 hover:text-tes-ink"
            >
              todd@theephemeralstate.com
            </a>{" "}
            or text{" "}
            <a
              href="sms:+12566841253"
              className="text-tes-kraft-dark underline underline-offset-2 hover:text-tes-ink"
            >
              256-684-1253
            </a>{" "}
            with your order number and we&rsquo;ll take it from there.
          </p>
        </div>
      </div>
    </section>
  );
}
