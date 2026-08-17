import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Subscription link issue",
};

const REASONS: Record<string, string> = {
  missing: "That link is missing its security token. Try clicking the link in your confirmation email again.",
  unknown: "We couldn't match that link to a subscriber. It may have been used already, or you may have unsubscribed.",
  expired: "That confirmation link expired. Sign up again from the footer and we'll send a fresh one.",
};

export default function NewsletterErrorPage({
  searchParams,
}: {
  searchParams: { reason?: string };
}) {
  const msg = REASONS[searchParams.reason ?? ""] ?? "Something went wrong following that newsletter link.";
  return (
    <section className="container-content py-20">
      <div className="max-w-prose mx-auto text-center">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Newsletter
        </p>
        <h1 className="font-marker text-4xl md:text-5xl leading-tight mb-5">
          Hmm.
        </h1>
        <p className="text-lg text-brand-ink/80 leading-relaxed mb-6">{msg}</p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-6 py-3 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors"
        >
          Back home
        </Link>
      </div>
    </section>
  );
}
