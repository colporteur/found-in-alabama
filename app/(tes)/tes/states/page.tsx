// Browse the states — every place category in the TES segment: the 50
// states under "Found in Other States", Districts & Territories, and
// the Alabama tree. Only states with in-stock items appear.

import type { Metadata } from "next";
import Link from "next/link";
import { getStorefrontCategoryTree } from "@/lib/ebay/storefront";
import { tesPrefix, tesHome } from "@/lib/tes/host";
import { CategoryGrid } from "@/components/tes/TesCategoryCards";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Browse the states",
  description:
    "American paper ephemera by the state it came from — postcards, photographs, and documents from Alabama to Wyoming, plus the districts and territories.",
  alternates: { canonical: "/states" },
};

export default async function TesStatesPage() {
  const prefix = tesPrefix();
  const groups = await getStorefrontCategoryTree({ segment: "tes" });
  const states = groups.filter((g) => g.isState);

  return (
    <section className="container-content py-12">
      <Link href={tesHome()} className="text-sm text-tes-ink/60 hover:text-tes-ink">
        ← Home
      </Link>
      <h1 className="font-typewriter text-3xl md:text-5xl leading-tight mt-3 mb-2">
        Browse the states
      </h1>
      <p className="text-tes-ink/70 mb-8 max-w-prose">
        Every piece here is tied to a place — a postcard mailed from it, a
        photograph taken in it, a document signed there. States appear as
        their shelves are stocked.
      </p>

      {states.length === 0 ? (
        <p className="text-tes-ink/60 italic">
          No state shelves are stocked right now — check back soon.
        </p>
      ) : (
        <CategoryGrid groups={states} prefix={prefix} />
      )}
    </section>
  );
}
