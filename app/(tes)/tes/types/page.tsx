// Browse by ephemera type — every non-place category in the TES
// segment: postcards, photographs, print ads, blotters, matchbooks,
// books, and the rest of the paper menagerie.

import type { Metadata } from "next";
import Link from "next/link";
import { getStorefrontCategoryTree } from "@/lib/ebay/storefront";
import { tesPrefix, tesHome } from "@/lib/tes/host";
import { CategoryGrid } from "@/components/tes/TesCategoryCards";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Browse by ephemera type",
  description:
    "Antique paper by kind — postcards, photographs, print ads, ink blotters, matchbooks, sheet music, maps, magazines, and more paper survivors.",
  alternates: { canonical: "/types" },
};

export default async function TesTypesPage() {
  const prefix = tesPrefix();
  const groups = await getStorefrontCategoryTree({ segment: "tes" });
  const types = groups.filter((g) => !g.isState);

  return (
    <section className="container-content py-12">
      <Link href={tesHome()} className="text-sm text-tes-ink/60 hover:text-tes-ink">
        ← Home
      </Link>
      <h1 className="font-typewriter text-3xl md:text-5xl leading-tight mt-3 mb-2">
        Browse by ephemera type
      </h1>
      <p className="text-tes-ink/70 mb-8 max-w-prose">
        The same shelves, sorted by what the paper is instead of where
        it&rsquo;s from.
      </p>

      {types.length === 0 ? (
        <p className="text-tes-ink/60 italic">
          Nothing stocked here right now — check back soon.
        </p>
      ) : (
        <CategoryGrid groups={types} prefix={prefix} />
      )}
    </section>
  );
}
