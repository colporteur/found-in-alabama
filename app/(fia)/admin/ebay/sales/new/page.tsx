// Create-a-sale form. Round 1: only MARKDOWN_CATEGORY is wired up. The
// other three sale types are visible in the type selector but currently
// disabled with a "coming next round" note.

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { ebayStoreCategories } from "@/db/schema";
import { asc } from "drizzle-orm";
import { buildCategoryTree } from "@/lib/ebay/category-tree";
import { getOAuthStatus } from "@/lib/ebay/oauth";
import NewSaleForm from "./NewSaleForm";
import MonthlySaleWizard from "@/components/MonthlySaleWizard";

export const dynamic = "force-dynamic";

export interface CategoryDTO {
  id: string;
  name: string;
  isAlabama: boolean;
}

export default async function NewSalePage() {
  const status = await getOAuthStatus();
  if (!status.connected) {
    redirect("/admin/ebay/sales/connect");
  }

  const cats = await db
    .select({
      categoryId: ebayStoreCategories.categoryId,
      parentCategoryId: ebayStoreCategories.parentCategoryId,
      name: ebayStoreCategories.name,
      isAlabama: ebayStoreCategories.isAlabamaRelated,
      isOtherBucket: ebayStoreCategories.isOtherBucket,
    })
    .from(ebayStoreCategories)
    .orderBy(asc(ebayStoreCategories.name));

  // Don't allow targeting the "Other" bucket itself with a sale — it'd
  // be too unfocused. (Sales should target categories the items truly
  // belong to.) Names are full paths so sibling leaves with generic
  // names ("Christmas & New Year's") stay distinguishable in the picker.
  const meta = new Map(cats.map((c) => [c.categoryId, c]));
  const eligible: CategoryDTO[] = buildCategoryTree(cats)
    .filter((c) => !meta.get(c.categoryId)?.isOtherBucket)
    .map((c) => ({
      id: c.categoryId,
      name: c.isLeaf ? c.path : `${c.path} (parent)`,
      isAlabama: meta.get(c.categoryId)?.isAlabama ?? false,
    }));

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        eBay tools · Sales · New
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">
        Create a sale
      </h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Schedule a markdown sale on one or more store categories. The sale
        runs on eBay between your start and end dates; you can edit or end
        it early from the sales list.
      </p>

      <MonthlySaleWizard />

      <NewSaleForm categories={eligible} />

      <div className="mt-10">
        <Link
          href="/admin/ebay/sales"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Back to sales
        </Link>
      </div>
    </section>
  );
}
