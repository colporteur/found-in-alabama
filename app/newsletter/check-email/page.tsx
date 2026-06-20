import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Check your inbox",
  description: "Confirmation email sent. Click the link inside to finish subscribing.",
};

export default function CheckEmailPage() {
  return (
    <section className="container-content py-20">
      <div className="max-w-prose mx-auto text-center">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Newsletter
        </p>
        <h1 className="font-marker text-4xl md:text-5xl leading-tight mb-5">
          Check your inbox.
        </h1>
        <p className="text-lg text-brand-ink/80 leading-relaxed mb-3">
          We just sent you a confirmation link. Click the button inside and
          you&rsquo;re on the list.
        </p>
        <p className="text-sm text-brand-ink/55 leading-relaxed mb-8">
          Didn&rsquo;t arrive in a minute or two? Check the spam folder — or
          try{" "}
          <Link
            href="/"
            className="underline decoration-brand-yellow decoration-2 underline-offset-2"
          >
            heading back home
          </Link>{" "}
          and entering your email again.
        </p>
      </div>
    </section>
  );
}
