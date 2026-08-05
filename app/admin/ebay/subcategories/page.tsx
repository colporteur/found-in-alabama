// /admin/ebay/subcategories — the subcategory analyzer (analysis half
// of the subcategorizer tool). Pick a crowded category (+ optional
// keyword to catch strays in Other), get a data-driven subcategory
// proposal to create on eBay and hard-code into the Nifty BIN
// extension's listing-time picker.

import { db, ebayStoreCategories } from "@/db";
import { asc } from "drizzle-orm";
import Link from "next/link";
import SubcategoryAnalyzer from "./SubcategoryAnalyzer";

export const dynamic = "force-dynamic";

export default async function SubcategoriesPage() {
  const categories = await db
    .select({
      categoryId: ebayStoreCategories.categoryId,
      name: ebayStoreCategories.name,
    })
    .from(ebayStoreCategories)
    .orderBy(asc(ebayStoreCategories.name));

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        eBay tools
      </p>
      <h1 className="font-marker text-4xl mb-2">Subcategory analyzer</h1>
      <p className="text-brand-ink/70 mb-8 max-w-2xl">
        Reads the real listing titles in a crowded store category (plus
        keyword matches hiding in Other) and proposes a subcategory
        taxonomy with counts, examples, and routing keywords. Create the
        winners as store categories on eBay, re-sync the tree, and wire
        them into the listing-time picker.
      </p>
      <SubcategoryAnalyzer categories={categories} />
      <div className="mt-10 pt-6 border-t border-brand-ink/10">
        <Link
          href="/admin/ebay"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          ← Back to eBay tools
        </Link>
      </div>
    </section>
  );
}
