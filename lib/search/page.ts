// Site search (SEARCH-1) — runs a /search page request for either site:
// the new engine once the index exists, the old title search before the
// migration runs. Logs what was searched (for /admin/search).

import { searchStorefrontItems, getStorefrontCategories, type StorefrontItem } from "@/lib/ebay/storefront";
import { searchReady } from "./index";
import { logSearch, searchItems, type Facet } from "./search";
import { readSearchParams, type SearchPageParams } from "./page-params";

type SP = { [key: string]: string | string[] | undefined };

export type SearchPageData = {
  params: SearchPageParams;
  ran: boolean;
  items: StorefrontItem[];
  related: StorefrontItem[];
  total: number;
  pages: number;
  facets: Facet[];
  didYouMean: string | null;
  fuzzyOnly: boolean;
  categoryName: string | null;
};

export async function runSearchPage(site: "fia" | "tes", sp: SP): Promise<SearchPageData> {
  const params = readSearchParams(sp);
  const ran = Boolean(params.q || params.category || params.min != null || params.max != null);
  const empty: SearchPageData = { params, ran, items: [], related: [], total: 0, pages: 1, facets: [], didYouMean: null, fuzzyOnly: false, categoryName: null };
  if (!ran) return empty;
  const shelves = await getStorefrontCategories({ segment: site }).catch(() => []);
  const categoryName = params.category ? shelves.find((s) => s.categoryId === params.category)?.name ?? null : null;

  if (!(await searchReady().catch(() => false))) {
    // Before migration 0048: the old all-words-in-the-title search.
    const r = await searchStorefrontItems(
      {
        q: params.q,
        categoryId: params.category || undefined,
        minPrice: params.min ?? undefined,
        maxPrice: params.max ?? undefined,
        sort: params.sort === "best" ? "newest" : params.sort,
        limit: 120,
      },
      { segment: site }
    );
    return { ...empty, items: r.items, total: r.total, categoryName };
  }

  const r = await searchItems({
    q: params.q,
    site,
    categoryId: params.category || null,
    minPrice: params.min,
    maxPrice: params.max,
    sort: params.sort,
    page: params.page,
  });
  if (params.q && params.page === 1) await logSearch(site, params.q, r.total);
  return {
    params,
    ran,
    items: r.items,
    related: r.related,
    total: r.total,
    pages: r.pages,
    facets: r.facets,
    didYouMean: r.didYouMean,
    fuzzyOnly: r.fuzzyOnly,
    categoryName,
  };
}
