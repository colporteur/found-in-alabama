// The Ephemeral State site header — postmark logo + minimal nav.
// Server component; uses tesPrefix() so links work both on the real
// domain and when previewing at /tes before DNS cutover.

import Link from "next/link";
import { tesHome, tesPrefix } from "@/lib/tes/host";
import CartLink from "@/components/tes/CartLink";

export default function TesHeader() {
  const prefix = tesPrefix();
  const home = tesHome();

  return (
    <header className="border-b border-tes-ink/10 bg-tes-cream">
      <div className="container-content py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Link href={home} className="inline-flex items-center gap-3 group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tes/logo.png"
            alt="The Ephemeral State"
            className="h-20 w-auto sm:h-24"
          />
          <span className="font-typewriter text-xl sm:text-2xl tracking-tight text-tes-ink group-hover:text-tes-kraft-dark transition-colors">
            The Ephemeral State
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link
            href={home}
            className="hover:underline underline-offset-4 decoration-tes-kraft decoration-2"
          >
            Browse the states
          </Link>
          <a
            href="sms:+12566841253"
            className="hover:underline underline-offset-4 decoration-tes-kraft decoration-2"
            title="Selling a collection? Text us."
          >
            We buy collections
          </a>
          <a
            href="https://www.foundinalabama.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-tes-ink/60 hover:text-tes-ink hover:underline underline-offset-4 decoration-tes-kraft decoration-2"
          >
            Found in Alabama
          </a>
          <CartLink href={`${prefix}/cart`} />
        </nav>
      </div>
      {/* Keep prefix referenced so future nav additions remember to use it. */}
      <span className="hidden" data-link-prefix={prefix} />
    </header>
  );
}
