import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Unsubscribed",
  description: "You've been removed from the Found in Alabama newsletter list.",
};

export default function GoodbyePage() {
  return (
    <section className="container-content py-20">
      <div className="max-w-prose mx-auto text-center">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Newsletter
        </p>
        <h1 className="font-marker text-4xl md:text-5xl leading-tight mb-5">
          You&rsquo;re unsubscribed.
        </h1>
        <p className="text-lg text-brand-ink/80 leading-relaxed mb-3">
          Sorry to see you go — we won&rsquo;t email you again.
        </p>
        <p className="text-base text-brand-ink/70 leading-relaxed mb-8">
          You can still browse the{" "}
          <Link
            href="/journal"
            className="underline decoration-brand-yellow decoration-2 underline-offset-2"
          >
            journal
          </Link>{" "}
          or the{" "}
          <Link
            href="/shop"
            className="underline decoration-brand-yellow decoration-2 underline-offset-2"
          >
            shop
          </Link>{" "}
          any time. And if you ever want back on the list, just sign up again
          from the footer.
        </p>
      </div>
    </section>
  );
}
