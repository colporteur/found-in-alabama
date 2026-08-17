import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Check your email",
  robots: { index: false, follow: false },
};

export default function CheckEmailPage() {
  return (
    <section className="container-content py-20">
      <div className="max-w-md mx-auto">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Admin
        </p>
        <h1 className="font-marker text-3xl md:text-4xl mb-4">
          Check your email.
        </h1>
        <p className="text-brand-ink/80 leading-relaxed mb-3">
          If the address you entered is the admin email, a sign-in link
          is on its way. Click it to finish signing in. The link is
          valid for 24 hours.
        </p>
        <p className="text-brand-ink/60 text-sm leading-relaxed">
          Not seeing it? Check spam, or{" "}
          <Link
            href="/signin"
            className="underline decoration-brand-yellow decoration-2 underline-offset-4"
          >
            try again
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
