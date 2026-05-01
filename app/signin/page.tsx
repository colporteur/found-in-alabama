import type { Metadata } from "next";
import { signIn } from "@/auth";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
}) {
  // If middleware bounced an unauthenticated user here, the original URL
  // they were trying to reach is in ?callbackUrl=. Default to /admin so
  // someone landing on /signin directly still ends up where they want.
  const requestedCallback = searchParams.callbackUrl;
  const safeCallback =
    requestedCallback && requestedCallback.startsWith("/")
      ? requestedCallback
      : "/admin";

  async function handleSignIn(formData: FormData) {
    "use server";
    await signIn("resend", formData, { redirectTo: safeCallback });
  }

  return (
    <section className="container-content py-20">
      <div className="max-w-md mx-auto">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Admin
        </p>
        <h1 className="font-marker text-3xl md:text-4xl mb-3">
          Sign in
        </h1>
        <p className="text-brand-ink/70 mb-8 text-sm leading-relaxed">
          Enter your email and we'll send you a one-time sign-in link.
          This area is restricted — only the admin email can actually
          receive a link.
        </p>

        <form action={handleSignIn} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full px-4 py-3 border border-brand-ink/20 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
          </div>
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center px-6 py-3 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors"
          >
            Send sign-in link →
          </button>
        </form>
      </div>
    </section>
  );
}
