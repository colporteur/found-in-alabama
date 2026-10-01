// "We buy collections" — simple static page linked from the TES header.
// Tells sellers what Todd buys (ephemera / old paper) and gives the
// number to text.

import type { Metadata } from "next";
import Link from "next/link";
import { tesHome } from "@/lib/tes/host";

export const metadata: Metadata = {
  title: "We buy collections",
  description:
    "The Ephemeral State buys collections of ephemera and old paper. Text 256-684-1253 with a few photos.",
  alternates: { canonical: "/we-buy" },
};

export default function TesWeBuyPage() {
  return (
    <section className="container-content py-12">
      <Link href={tesHome()} className="text-sm text-tes-ink/60 hover:text-tes-ink">
        ← Home
      </Link>
      <h1 className="font-typewriter text-3xl md:text-5xl leading-tight mt-3 mb-6">
        I buy collections
      </h1>

      <div className="max-w-prose space-y-6 text-tes-ink/90 leading-relaxed text-lg">
        <p>
          I buy collections of ephemera and old paper &mdash; postcards,
          photographs, letters, advertising, trade cards, menus, programs,
          maps, magazines, and all the other paper that was never meant to
          last. Whole collections, boxes, and albums are welcome.
        </p>
        <p>
          Have something to sell? Send me a text with a few photos and a
          short description.
        </p>

        <div className="bg-white rounded-xl ring-1 ring-tes-ink/10 p-6 text-center">
          <p className="text-sm text-tes-ink/60 mb-1">Text inquiries</p>
          <a
            href="sms:+12566841253"
            className="font-typewriter text-3xl md:text-4xl text-tes-kraft-dark hover:text-tes-ink underline underline-offset-4"
          >
            256-684-1253
          </a>
        </div>
      </div>
    </section>
  );
}
