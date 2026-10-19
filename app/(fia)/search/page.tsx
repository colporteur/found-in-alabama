// FIA search — foundinalabama.com/search (SEARCH-1). Same engine as The
// Ephemeral State's search, over everything in stock.

import type { Metadata } from "next";
import StorefrontItemCard from "@/components/StorefrontItemCard";
import SearchResultsView from "@/components/search/SearchResultsView";
import { getFiaDiscountPercent } from "@/lib/fia/settings";
import { runSearchPage } from "@/lib/search/page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Search the shop",
  robots: { index: false },
};

type SP = { [key: string]: string | string[] | undefined };

export default async function FiaSearchPage({ searchParams }: { searchParams: SP }) {
  const [data, flatPct] = await Promise.all([runSearchPage("fia", searchParams), getFiaDiscountPercent()]);
  return (
    <SearchResultsView
      site="fia"
      title="Search the shop"
      hint="Birmingham, Crimson Tide, cookbook, 1950s…"
      params={data.params}
      ran={data.ran}
      total={data.total}
      pages={data.pages}
      facets={data.facets}
      didYouMean={data.didYouMean}
      fuzzyOnly={data.fuzzyOnly}
      categoryName={data.categoryName}
      cards={data.items.map((item) => <StorefrontItemCard key={item.itemId} item={item} flatPct={flatPct} />)}
      related={data.related.map((item) => <StorefrontItemCard key={item.itemId} item={item} flatPct={flatPct} />)}
    />
  );
}
