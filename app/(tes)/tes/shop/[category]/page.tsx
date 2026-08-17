// One TES category's item grid. Items link out to their eBay listings.
// Resolves slugs against the "tes" segment only, so FIA-only categories
// 404 here even if their slug is guessed.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCategoryItems,
  resolveCategorySlug,
} from "@/lib/ebay/storefront";
import TesItemCard from "@/components/tes/TesItemCard";
import { tesHome } from "@/lib/tes/host";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: { category: string };
}): Promise<Metadata> {
  const cat = await resolveCategorySlug(params.category, { segment: "tes" });
  if (!cat) return { title: "Category not found" };
  return {
    title: `${cat.name} — The Ephemeral State`,
    description: `Browse ${cat.count} ${cat.name.toLowerCase()} pieces at The Ephemeral State. Every item links to its eBay listing.`,
  };
}

export default async function TesCategoryPage({
  params,
}: {
  params: { category: string };
}) {
  const category = await resolveCategorySlug(params.category, {
    segment: "tes",
  });
  if (!category) notFound();

  const items = await getCategoryItems(category);

  return (
    <section className="container-content py-12">
      <Link
        href={tesHome()}
        className="text-sm text-tes-ink/60 hover:text-tes-ink"
      >
        ← All categories
      </Link>
      <h1 className="font-typewriter text-3xl md:text-5xl leading-tight mt-3 mb-2">
        {category.name}
      </h1>
      <p className="text-tes-ink/70 mb-8">
        {category.count} {category.count === 1 ? "piece" : "pieces"}.
      </p>

      {items.length === 0 ? (
        <p className="text-tes-ink/60 italic">
          Nothing in stock here right now.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((item) => (
            <TesItemCard key={item.itemId} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
