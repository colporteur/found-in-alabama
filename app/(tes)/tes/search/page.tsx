// TES search — /search on the TES domain. Server-rendered from query
// params: q (keywords, all must match the title), category, min/max
// price, sort. Results reuse the standard item cards.

import type { Metadata } from "next";
import {
  getStorefrontCategories,
  searchStorefrontItems,
  type StorefrontSearchParams,
} from "@/lib/ebay/storefront";
import { tesPrefix } from "@/lib/tes/host";
import { getTesDiscountPercent } from "@/lib/tes/discount";
import TesItemCard from "@/components/tes/TesItemCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Search the collection",
  robots: { index: false },
};

type SP = { [key: string]: string | string[] | undefined };
const first = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? (v[0] ?? "") : (v ?? "");

export default async function TesSearchPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const prefix = tesPrefix();
  const q = first(searchParams.q).slice(0, 100);
  const categoryId = first(searchParams.category);
  const min = parseFloat(first(searchParams.min));
  const max = parseFloat(first(searchParams.max));
  const sortRaw = first(searchParams.sort);
  const sort: StorefrontSearchParams["sort"] =
    sortRaw === "price-asc" || sortRaw === "price-desc" ? sortRaw : "newest";

  const [cats, flatPct] = await Promise.all([
    getStorefrontCategories({ segment: "tes" }),
    getTesDiscountPercent(),
  ]);
  const hasQuery = Boolean(q || categoryId || Number.isFinite(min) || Number.isFinite(max));

  const result = hasQuery
    ? await searchStorefrontItems(
        {
          q,
          categoryId: categoryId || undefined,
          minPrice: Number.isFinite(min) ? min : undefined,
          maxPrice: Number.isFinite(max) ? max : undefined,
          sort,
          limit: 120,
        },
        { segment: "tes" }
      )
    : null;

  return (
    <section className="container-content py-12">
      <h1 className="font-typewriter text-3xl md:text-5xl leading-tight mb-6">
        Search the collection
      </h1>

      <form
        method="GET"
        action={`${prefix}/search`}
        className="bg-white rounded-xl ring-1 ring-tes-ink/10 p-4 mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end"
      >
        <label className="block lg:col-span-2">
          <span className="text-[11px] uppercase tracking-wider text-tes-stamp">
            Keywords
          </span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="postcard, depot, cotton mill…"
            className="mt-1 w-full border border-tes-ink/15 rounded-md px-3 py-2 text-sm bg-tes-cream/50 focus:outline-none focus:border-tes-kraft"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-tes-stamp">
            Category
          </span>
          <select
            name="category"
            defaultValue={categoryId}
            className="mt-1 w-full border border-tes-ink/15 rounded-md px-2 py-2 text-sm bg-tes-cream/50"
          >
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <label className="block flex-1">
            <span className="text-[11px] uppercase tracking-wider text-tes-stamp">
              Min $
            </span>
            <input
              type="number"
              name="min"
              min="0"
              step="1"
              defaultValue={Number.isFinite(min) ? String(min) : ""}
              className="mt-1 w-full border border-tes-ink/15 rounded-md px-2 py-2 text-sm bg-tes-cream/50"
            />
          </label>
          <label className="block flex-1">
            <span className="text-[11px] uppercase tracking-wider text-tes-stamp">
              Max $
            </span>
            <input
              type="number"
              name="max"
              min="0"
              step="1"
              defaultValue={Number.isFinite(max) ? String(max) : ""}
              className="mt-1 w-full border border-tes-ink/15 rounded-md px-2 py-2 text-sm bg-tes-cream/50"
            />
          </label>
        </div>
        <div className="flex gap-2 items-end">
          <label className="block flex-1">
            <span className="text-[11px] uppercase tracking-wider text-tes-stamp">
              Sort
            </span>
            <select
              name="sort"
              defaultValue={sort}
              className="mt-1 w-full border border-tes-ink/15 rounded-md px-2 py-2 text-sm bg-tes-cream/50"
            >
              <option value="newest">Newest</option>
              <option value="price-asc">Price: low → high</option>
              <option value="price-desc">Price: high → low</option>
            </select>
          </label>
          <button
            type="submit"
            className="px-5 py-2 rounded-md bg-tes-ink text-tes-cream text-sm font-medium hover:bg-tes-ink/85 transition-colors"
          >
            Search
          </button>
        </div>
      </form>

      {!result ? (
        <p className="text-tes-ink/60 italic">
          Type a few words, pick a category, or set a price range — then hit
          Search.
        </p>
      ) : result.items.length === 0 ? (
        <p className="text-tes-ink/60 italic">
          Nothing matched. Try fewer or different words — titles are terse on
          old paper.
        </p>
      ) : (
        <>
          <p className="text-sm text-tes-ink/60 mb-4">
            {result.total.toLocaleString()} match{result.total === 1 ? "" : "es"}
            {result.total > result.items.length
              ? ` — showing the first ${result.items.length}; narrow the search to see the rest`
              : ""}
            .
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {result.items.map((item) => (
              <TesItemCard
                key={item.itemId}
                item={item}
                flatDiscountPercent={flatPct}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
