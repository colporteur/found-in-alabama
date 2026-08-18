// The Ephemeral State home — hero, then two browse dimensions: the
// states (everything under "Found in Other States" plus the Alabama
// tree) and the ephemera types (everything else in the TES segment).

import type { Metadata } from "next";
import Link from "next/link";
import { getStorefrontCategoryTree } from "@/lib/ebay/storefront";
import { tesPrefix } from "@/lib/tes/host";
import { CategoryGrid } from "@/components/tes/TesCategoryCards";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "The Ephemeral State — Antique paper Americana, state by state",
  description:
    "Browse postcards, photographs, documents, and other paper survivors by state and by kind. Every piece has its own page and ships flat from our shop.",
  // Canonical always points at the real domain, so the /tes preview path
  // on foundinalabama.com never competes in search.
  alternates: { canonical: "/" },
};

export default async function TesHomePage() {
  const prefix = tesPrefix();
  const groups = await getStorefrontCategoryTree({ segment: "tes" });
  const states = groups.filter((g) => g.isState);
  const types = groups.filter((g) => !g.isState);
  const totalItems = groups.reduce(
    (sum, g) => sum + g.count + g.children.reduce((s, c) => s + c.count, 0),
    0
  );

  return (
    <>
      <section className="border-b border-tes-ink/10 bg-tes-kraft/15">
        <div className="container-content py-14 md:py-20">
          <p className="text-xs uppercase tracking-[0.2em] text-tes-stamp mb-4">
            Antique paper Americana
          </p>
          <h1 className="font-typewriter text-4xl md:text-6xl leading-tight mb-5 max-w-3xl">
            Paper survivors, sorted by the state they came from.
          </h1>
          <p className="text-lg text-tes-ink/75 max-w-prose leading-relaxed">
            Postcards, photographs, letters, documents, and other ephemera —
            the paper that outlived its errand.{" "}
            {totalItems > 0
              ? `${totalItems.toLocaleString()} pieces in stock.`
              : ""}
          </p>
        </div>
      </section>

      {groups.length === 0 ? (
        <section className="container-content py-12">
          <div className="bg-white rounded-xl ring-1 ring-tes-ink/10 p-12 text-center">
            <p className="font-typewriter text-2xl text-tes-ink/40 mb-1">
              The cases are being filled.
            </p>
            <p className="text-sm text-tes-ink/60">
              Categories appear here once they&rsquo;re flagged for The
              Ephemeral State and stocked.
            </p>
          </div>
        </section>
      ) : (
        <>
          {states.length > 0 && (
            <section id="states" className="container-content py-12">
              <div className="flex items-baseline justify-between gap-3 mb-6">
                <h2 className="font-typewriter text-2xl md:text-3xl">
                  Browse the states
                </h2>
                <Link
                  href={`${prefix}/states`}
                  className="text-sm text-tes-ink/60 hover:text-tes-ink underline underline-offset-4 decoration-tes-kraft"
                >
                  All states →
                </Link>
              </div>
              <CategoryGrid groups={states} prefix={prefix} />
            </section>
          )}

          {types.length > 0 && (
            <section
              id="types"
              className="container-content py-12 border-t border-tes-ink/10"
            >
              <div className="flex items-baseline justify-between gap-3 mb-6">
                <h2 className="font-typewriter text-2xl md:text-3xl">
                  Browse by ephemera type
                </h2>
                <Link
                  href={`${prefix}/types`}
                  className="text-sm text-tes-ink/60 hover:text-tes-ink underline underline-offset-4 decoration-tes-kraft"
                >
                  All types →
                </Link>
              </div>
              <CategoryGrid groups={types} prefix={prefix} />
            </section>
          )}
        </>
      )}

      <section className="border-t border-tes-ink/10 bg-white">
        <div className="container-content py-12 md:flex md:items-center md:justify-between md:gap-8">
          <div className="max-w-prose">
            <h2 className="font-typewriter text-2xl md:text-3xl mb-2">
              Sitting on a collection?
            </h2>
            <p className="text-tes-ink/75 leading-relaxed">
              We buy ephemera — postcards, photographs, letters, documents,
              scrapbooks, whole boxes and whole estates. One piece or a
              thousand, anywhere in the U.S.
            </p>
          </div>
          <a
            href="sms:+12566841253"
            className="inline-block mt-5 md:mt-0 shrink-0 px-6 py-3 rounded-md bg-tes-ink text-tes-cream font-medium hover:bg-tes-ink/85 transition-colors"
          >
            Text us: 256-684-1253 →
          </a>
        </div>
      </section>
    </>
  );
}
