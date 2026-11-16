// The Ephemeral State site footer — minimal v1: blurb, we-buy line,
// family credit, contact email, and the policy links Merchant Center
// checks for (about, contact, shipping, returns, privacy). (Newsletter and socials stay
// FIA-only for now.)

import Link from "next/link";
import { tesPrefix } from "@/lib/tes/host";
import { BUSINESS, TES_EMAIL } from "@/lib/business";

export default function TesFooter() {
  const prefix = tesPrefix();
  return (
    <footer className="border-t border-tes-ink/10 bg-tes-ink text-tes-cream mt-16">
      <div className="container-content py-10">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <p className="font-typewriter text-2xl leading-tight mb-3">
              The Ephemeral State
            </p>
            <p className="text-sm text-tes-cream/80 leading-relaxed max-w-prose">
              Antique paper Americana, state by state — postcards,
              photographs, documents, and other paper survivors.
            </p>
          </div>
          <div className="md:text-right text-sm space-y-2">
            <p>
              <a
                href="sms:+12566841253"
                className="text-tes-kraft hover:text-tes-cream transition-colors font-medium"
              >
                We buy ephemera collections — text 256-684-1253
              </a>
            </p>
            <p>
              <a
                href="https://www.foundinalabama.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-tes-kraft transition-colors"
              >
                Part of the Found in Alabama family
              </a>
            </p>
            <p>
              <a
                href={`mailto:${TES_EMAIL}`}
                className="hover:text-tes-kraft transition-colors"
              >
                {TES_EMAIL}
              </a>
            </p>
            <nav
              aria-label="Store policies"
              className="flex flex-wrap md:justify-end gap-x-4 gap-y-1 text-tes-cream/60"
            >
              {[
                ["About", "/about"],
                ["Contact", "/contact"],
                ["Shipping", "/shipping"],
                ["Returns & refunds", "/returns"],
                ["Privacy", "/privacy"],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={`${prefix}${href}`}
                  className="hover:text-tes-kraft transition-colors"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
        <p className="mt-8 pt-6 border-t border-tes-cream/20 text-xs text-tes-cream/50">
          © {new Date().getFullYear()} The Ephemeral State · Ships from{" "}
          {BUSINESS.shipsFrom} · {BUSINESS.phone}
        </p>
      </div>
    </footer>
  );
}
