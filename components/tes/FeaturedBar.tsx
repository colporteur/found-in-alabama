// Featured-category bar — top-of-the-fold merchandising strip on the
// TES home page. Slots are configured at /admin/tes-featured. Parent
// categories (and the special Explore-by-State slot) get a pure-CSS
// hover/focus dropdown of their children — no client JS.

import Link from "next/link";
import {
  getStorefrontCategories,
  getStorefrontCategoryTree,
  type StorefrontCategory,
  type StorefrontCategoryGroup,
} from "@/lib/ebay/storefront";
import { getFeaturedSlotStrings, parseSlot } from "@/lib/tes/featured";
import { tesPrefix } from "@/lib/tes/host";

type ResolvedSlot = {
  key: string;
  label: string;
  /** null = no landing page of its own (pure-dropdown parent). */
  href: string | null;
  children: { label: string; href: string }[];
};

function resolveSlots(
  slotStrings: string[],
  groups: StorefrontCategoryGroup[],
  flat: StorefrontCategory[],
  prefix: string
): ResolvedSlot[] {
  const out: ResolvedSlot[] = [];
  for (const raw of slotStrings) {
    const slot = parseSlot(raw);
    if (!slot) continue;
    if (slot.type === "states") {
      const states = groups.filter((g) => g.isState);
      out.push({
        key: "states",
        label: "Explore by State",
        href: `${prefix}/states`,
        children: states.map((s) => ({
          label: s.name,
          href: `${prefix}/shop/${s.slug}`,
        })),
      });
      continue;
    }
    // A category slot: it may be a top-level group or a child of one.
    const group = groups.find((g) => g.categoryId === slot.categoryId);
    if (group) {
      out.push({
        key: group.categoryId,
        label: group.name,
        href: `${prefix}/shop/${group.slug}`,
        children: group.children.map((c) => ({
          label: c.name,
          href: `${prefix}/shop/${c.slug}`,
        })),
      });
      continue;
    }
    const child = (() => {
      for (const g of groups) {
        const c = g.children.find((x) => x.categoryId === slot.categoryId);
        if (c) return c;
      }
      return null;
    })();
    if (child) {
      out.push({
        key: child.categoryId,
        label: child.name,
        href: `${prefix}/shop/${child.slug}`,
        children: [],
      });
      continue;
    }
    // Unstocked PARENT category (holds no items directly): synthesize a
    // dropdown-only slot from its stocked children in the flat list.
    const kids = flat.filter((c) => c.parentCategoryId === slot.categoryId);
    if (kids.length > 0) {
      out.push({
        key: slot.categoryId,
        label: kids[0].parentName ?? "Browse",
        href: null,
        children: kids
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({ label: c.name, href: `${prefix}/shop/${c.slug}` })),
      });
    }
  }
  return out;
}

export default async function FeaturedBar() {
  const [slotStrings, groups, flat] = await Promise.all([
    getFeaturedSlotStrings(),
    getStorefrontCategoryTree({ segment: "tes" }),
    getStorefrontCategories({ segment: "tes" }),
  ]);
  if (slotStrings.length === 0) return null;
  const prefix = tesPrefix();
  const slots = resolveSlots(slotStrings, groups, flat, prefix);
  if (slots.length === 0) return null;

  return (
    <nav
      aria-label="Featured categories"
      className="border-b border-tes-ink/10 bg-white"
    >
      <div className="container-content flex flex-wrap items-center gap-1 py-2">
        <span className="text-[11px] uppercase tracking-[0.15em] text-tes-stamp mr-2">
          Featured
        </span>
        {slots.map((slot) => (
          <div key={slot.key} className="relative group">
            {slot.href ? (
              <Link
                href={slot.href}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium hover:bg-tes-kraft/20 text-tes-ink transition-colors"
              >
                {slot.label}
                {slot.children.length > 0 && (
                  <span aria-hidden className="text-tes-ink/40 text-xs">▾</span>
                )}
              </Link>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium hover:bg-tes-kraft/20 text-tes-ink transition-colors cursor-default"
              >
                {slot.label}
                <span aria-hidden className="text-tes-ink/40 text-xs">▾</span>
              </button>
            )}
            {slot.children.length > 0 && (
              <div className="absolute left-0 top-full z-40 hidden group-hover:block group-focus-within:block pt-1">
                <div className="bg-white rounded-lg shadow-lg ring-1 ring-tes-ink/10 py-2 min-w-[220px] max-h-[60vh] overflow-y-auto">
                  {slot.children.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      className="block px-4 py-1.5 text-sm text-tes-ink/80 hover:bg-tes-cream hover:text-tes-ink"
                    >
                      {c.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
