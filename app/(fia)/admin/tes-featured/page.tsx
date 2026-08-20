// /admin/tes-featured — configure the featured-category bar on the
// theephemeralstate.com home page. Six slots; each is empty, the
// special "Explore by State" entry, or any TES category (parents get a
// dropdown of their children on the storefront).

import Link from "next/link";
import { getStorefrontCategories } from "@/lib/ebay/storefront";
import { getFeaturedSlotStrings } from "@/lib/tes/featured";
import FeaturedEditor from "./FeaturedEditor";

export const dynamic = "force-dynamic";

export default async function TesFeaturedPage() {
  const [cats, slots] = await Promise.all([
    getStorefrontCategories({ segment: "tes" }),
    getFeaturedSlotStrings(),
  ]);

  // Stocked categories, plus PARENT categories that hold no items
  // directly but have stocked children (e.g. "Vintage Postcards") — those
  // are exactly the ones that make good featured slots with dropdowns.
  const stockedIds = new Set(cats.map((c) => c.categoryId));
  const parentOnly = new Map<string, { name: string; children: number }>();
  for (const c of cats) {
    if (c.parentCategoryId && !stockedIds.has(c.parentCategoryId)) {
      const cur = parentOnly.get(c.parentCategoryId);
      parentOnly.set(c.parentCategoryId, {
        name: c.parentName ?? "Unnamed parent",
        children: (cur?.children ?? 0) + 1,
      });
    }
  }
  const options = [
    ...[...parentOnly.entries()].map(([id, p]) => ({
      value: `cat:${id}`,
      label: `📁 ${p.name} (parent — ${p.children} subcategories)`,
    })),
    ...cats.map((c) => ({
      value: `cat:${c.categoryId}`,
      label: `${c.name}${c.isState ? " (state)" : ""} — ${c.count} items`,
    })),
  ];

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        The Ephemeral State
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">Featured categories</h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        These fill the featured bar at the top of theephemeralstate.com. Pick
        up to six. A category that has child categories shows them in a
        dropdown; &ldquo;Explore by State&rdquo; shows a dropdown of every
        stocked state. Empty slots are skipped.
      </p>
      <FeaturedEditor options={options} initial={slots} />
      <div className="mt-10">
        <Link href="/admin" className="text-sm text-brand-ink/60 hover:text-brand-ink">
          ← Back to admin
        </Link>
      </div>
    </section>
  );
}
