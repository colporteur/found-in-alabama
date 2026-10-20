// TES search — /search on the TES domain (SEARCH-1). Words, typos and
// meaning over titles, shelves and descriptions (lib/search); shelf filters,
// price range, sort, pages and related items. Server-rendered from the URL.

import type { Metadata } from "next";
import { getTesDiscountPercent } from "@/lib/tes/discount";
import TesItemCard from "@/components/tes/TesItemCard";
import SearchResultsView from "@/components/search/SearchResultsView";
import { runSearchPage } from "@/lib/search/page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Search the collection",
  robots: { index: false },
};

type SP = { [key: string]: string | string[] | undefined };

export default async function TesSearchPage({ searchParams }: { searchParams: SP }) {
  const [data, flatPct] = await Promise.all([runSearchPage("tes", searchParams), getTesDiscountPercent()]);
  return (
    <SearchResultsView
      site="tes"
      title="Search the collection"
      hint="postcard, depot, cotton mill…"
      params={data.params}
      ran={data.ran}
      total={data.total}
      pages={data.pages}
      facets={data.facets}
      didYouMean={data.didYouMean}
      fuzzyOnly={data.fuzzyOnly}
      categoryName={data.categoryName}
      cards={data.items.map((item) => <TesItemCard key={item.itemId} item={item} flatDiscountPercent={flatPct} />)}
      related={data.related.map((item) => <TesItemCard key={item.itemId} item={item} flatDiscountPercent={flatPct} />)}
    />
  );
}
