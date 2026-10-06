// Data for the foundinalabama.com home page (Oct 2026): feature the
// Alabama inventory and the biggest non-ephemera categories instead of the
// journal. "Alabama" = any category flagged isAlabamaRelated in the
// categories admin, or a descendant of one. "Ephemera" = anything that
// qualifies for The Ephemeral State (flagged isEphemeralState, or a
// descendant) — that inventory already has its own site.

import { db } from "@/db";
import { ebayStoreCategories } from "@/db/schema";
import {
  getCategoryItems,
  getStorefrontCategories,
  type StorefrontCategory,
  type StorefrontItem,
} from "@/lib/ebay/storefront";
import { tesQualifyingSet } from "@/lib/tes/selection";

export type HomeShelves = {
  alabamaCategories: StorefrontCategory[];
  alabamaItems: StorefrontItem[];
  alabamaTotal: number;
  /** All in-stock Alabama categories (the shelf shows the first few). */
  alabamaCategoryCount: number;
  topCategories: StorefrontCategory[];
};

type Cat = {
  categoryId: string;
  parentCategoryId: string | null;
  isAlabamaRelated: boolean;
  isEphemeralState: boolean;
};

/** Categories flagged by `flag`, plus every descendant of a flagged one. */
function flaggedWithDescendants(cats: Cat[], flag: (c: Cat) => boolean): Set<string> {
  const parentOf = new Map(cats.map((c) => [c.categoryId, c.parentCategoryId]));
  const flagged = new Set(cats.filter(flag).map((c) => c.categoryId));
  const out = new Set<string>();
  for (const c of cats) {
    let cur: string | null = c.categoryId;
    for (let hops = 0; cur != null && hops < 20; hops++) {
      if (flagged.has(cur)) {
        out.add(c.categoryId);
        break;
      }
      cur = parentOf.get(cur) ?? null;
    }
  }
  return out;
}

async function loadSegments() {
  const [cats, storefront] = await Promise.all([
    db
      .select({
        categoryId: ebayStoreCategories.categoryId,
        parentCategoryId: ebayStoreCategories.parentCategoryId,
        isAlabamaRelated: ebayStoreCategories.isAlabamaRelated,
        isEphemeralState: ebayStoreCategories.isEphemeralState,
      })
      .from(ebayStoreCategories),
    getStorefrontCategories({ segment: "fia" }),
  ]);
  return {
    alabama: flaggedWithDescendants(cats, (c) => c.isAlabamaRelated),
    ephemera: tesQualifyingSet(cats),
    shelf: storefront.filter((c) => !c.isNewArrivals && c.count > 0),
  };
}

const byCount = (a: StorefrontCategory, b: StorefrontCategory) => b.count - a.count;

/** Every in-stock Alabama category, biggest first (the /alabama page). */
export async function getAlabamaCategories(): Promise<StorefrontCategory[]> {
  const { alabama, shelf } = await loadSegments();
  return shelf.filter((c) => alabama.has(c.categoryId)).sort(byCount);
}

export async function getHomeShelves(
  opts: { alabamaCategories?: number; alabamaItems?: number; topCategories?: number } = {}
): Promise<HomeShelves> {
  const nAlabamaCats = opts.alabamaCategories ?? 8;
  const nAlabamaItems = opts.alabamaItems ?? 8;
  const nTop = opts.topCategories ?? 8;

  const { alabama, ephemera, shelf } = await loadSegments();

  const alabamaCats = shelf.filter((c) => alabama.has(c.categoryId)).sort(byCount);
  const topCategories = shelf
    .filter((c) => !alabama.has(c.categoryId) && !ephemera.has(c.categoryId))
    .sort(byCount)
    .slice(0, nTop);

  // Newest in-stock Alabama pieces across every Alabama category. Reuses
  // the shop's item shaping (sale badges, marketplace links, ship class)
  // through a synthetic category that covers every Alabama id.
  const alabamaIds = Array.from(alabama);
  let alabamaItems: StorefrontItem[] = [];
  if (alabamaIds.length > 0) {
    const pseudo: StorefrontCategory = {
      categoryId: alabamaIds[0],
      categoryIds: alabamaIds,
      name: "Alabama",
      slug: "alabama",
      count: 0,
      isNewArrivals: false,
      parentCategoryId: null,
      onSaleCount: 0,
      wholeCategoryOnSale: false,
      imageUrl: null,
      isState: true,
      parentName: null,
    };
    const items = await getCategoryItems(pseudo, nAlabamaItems * 3);
    // Prefer items with a photo.
    alabamaItems = items
      .filter((i) => i.imageUrl)
      .concat(items.filter((i) => !i.imageUrl))
      .slice(0, nAlabamaItems);
  }

  return {
    alabamaCategories: alabamaCats.slice(0, nAlabamaCats),
    alabamaItems,
    alabamaTotal: alabamaCats.reduce((n, c) => n + c.count, 0),
    alabamaCategoryCount: alabamaCats.length,
    topCategories,
  };
}
