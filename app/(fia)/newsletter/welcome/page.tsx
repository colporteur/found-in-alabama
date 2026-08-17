import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "You're in",
  description: "Subscription confirmed. Next newsletter goes out on the first of the month.",
};

export default function WelcomePage() {
  return (
    <section className="container-content py-20">
      <div className="max-w-prose mx-auto text-center">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Newsletter
        </p>
        <h1 className="font-marker text-4xl md:text-5xl leading-tight mb-5">
          You&rsquo;re on the list.
        </h1>
        <p className="text-lg text-brand-ink/80 leading-relaxed mb-3">
          We send a newsletter once a month — recent hauls, items currently
          for sale, and what sold lately. No sales pitches, no daily blasts.
        </p>
        <p className="text-base text-brand-ink/70 leading-relaxed mb-8">
          While you&rsquo;re here, check out the{" "}
          <Link
            href="/journal"
            className="underline decoration-brand-yellow decoration-2 underline-offset-2"
          >
            recent hauls
          </Link>{" "}
          or{" "}
          <Link
            href="/shop"
            className="underline decoration-brand-yellow decoration-2 underline-offset-2"
          >
            browse the inventory
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
