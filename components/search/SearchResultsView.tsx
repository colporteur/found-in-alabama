// The /search page body for both storefronts (SEARCH-1): refine form, "Did
// you mean", shelf filters with counts, sort, the results grid, pages, and
// related-by-meaning items. Server component; the cards come in rendered so
// each site keeps its own card style.

import type { ReactNode } from "react";
import Link from "next/link";
import type { Facet } from "@/lib/search/search";
import { searchHref, type SearchPageParams } from "@/lib/search/page-params";

const T = {
  fia: {
    h1: "font-marker text-3xl md:text-5xl leading-tight mb-6",
    box: "bg-white rounded-xl ring-1 ring-brand-ink/10 p-4 mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end",
    label: "text-[11px] uppercase tracking-wider text-brand-earth",
    input: "mt-1 w-full border border-brand-ink/15 rounded-md px-3 py-2 text-sm bg-brand-paper/50 focus:outline-none focus:border-brand-yellow",
    button: "px-5 py-2 rounded-md bg-brand-ink text-white text-sm font-medium hover:bg-brand-ink/85",
    chip: "border-brand-ink/20 hover:border-brand-ink/50",
    chipOn: "bg-brand-ink text-white border-brand-ink",
    muted: "text-brand-ink/60",
    link: "underline decoration-brand-yellow decoration-2 underline-offset-4",
  },
  tes: {
    h1: "font-typewriter text-3xl md:text-5xl leading-tight mb-6",
    box: "bg-white rounded-xl ring-1 ring-tes-ink/10 p-4 mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end",
    label: "text-[11px] uppercase tracking-wider text-tes-stamp",
    input: "mt-1 w-full border border-tes-ink/15 rounded-md px-3 py-2 text-sm bg-tes-cream/50 focus:outline-none focus:border-tes-kraft",
    button: "px-5 py-2 rounded-md bg-tes-ink text-tes-cream text-sm font-medium hover:bg-tes-ink/85",
    chip: "border-tes-ink/20 hover:border-tes-ink/50",
    chipOn: "bg-tes-ink text-tes-cream border-tes-ink",
    muted: "text-tes-ink/60",
    link: "underline decoration-tes-kraft decoration-2 underline-offset-4",
  },
};

export default function SearchResultsView({
  site,
  title,
  params,
  ran,
  total,
  pages,
  cards,
  related,
  facets,
  didYouMean,
  fuzzyOnly,
  categoryName,
  hint,
}: {
  site: "fia" | "tes";
  title: string;
  params: SearchPageParams;
  /** False when nothing was asked yet. */
  ran: boolean;
  total: number;
  pages: number;
  cards: ReactNode[];
  related: ReactNode[];
  facets: Facet[];
  didYouMean: string | null;
  fuzzyOnly: boolean;
  categoryName: string | null;
  hint: string;
}) {
  const t = T[site];
  const sorts: Array<[SearchPageParams["sort"], string]> = [
    ...(params.q ? ([["best", "Best match"]] as Array<[SearchPageParams["sort"], string]>) : []),
    ["newest", "Newest"],
    ["price-asc", "Price: low → high"],
    ["price-desc", "Price: high → low"],
  ];
  return (
    <section className="container-content py-12">
      <h1 className={t.h1}>{title}</h1>

      <form method="GET" action="/search" className={t.box}>
        <label className="block lg:col-span-3">
          <span className={t.label}>Keywords</span>
          <input type="search" name="q" defaultValue={params.q} placeholder={hint} className={t.input} />
        </label>
        <label className="block">
          <span className={t.label}>Min $</span>
          <input type="number" name="min" min="0" step="1" defaultValue={params.min ?? ""} className={t.input} />
        </label>
        <label className="block">
          <span className={t.label}>Max $</span>
          <input type="number" name="max" min="0" step="1" defaultValue={params.max ?? ""} className={t.input} />
        </label>
        {params.category && <input type="hidden" name="category" value={params.category} />}
        {params.sort !== "best" && params.sort !== "newest" && <input type="hidden" name="sort" value={params.sort} />}
        <button type="submit" className={t.button}>
          Search
        </button>
      </form>

      {!ran ? (
        <p className={`${t.muted} italic`}>Type a few words — a town, a maker, a year, a kind of thing — then hit Search.</p>
      ) : (
        <>
          {didYouMean && (
            <p className="mb-4 text-lg">
              Did you mean{" "}
              <Link href={searchHref(params, { q: didYouMean })} className={`${t.link} font-semibold italic`}>
                {didYouMean}
              </Link>
              ?
            </p>
          )}

          {facets.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm mb-4">
              <Link href={searchHref(params, { category: "" })} className={`px-3 py-1 rounded-full border ${!params.category ? t.chipOn : t.chip}`}>
                All shelves
              </Link>
              {facets.map((f) => (
                <Link
                  key={f.categoryId}
                  href={searchHref(params, { category: f.categoryId })}
                  className={`px-3 py-1 rounded-full border ${params.category === f.categoryId ? t.chipOn : t.chip}`}
                >
                  {f.name} ({f.count.toLocaleString()})
                </Link>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 text-sm">
            <p className={t.muted}>
              {total.toLocaleString()} {total === 1 ? "match" : "matches"}
              {params.q && (
                <>
                  {" "}
                  for <b>&ldquo;{params.q}&rdquo;</b>
                </>
              )}
              {categoryName && <> in {categoryName}</>}
              {fuzzyOnly && " — close spellings"}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {sorts.map(([v, label]) => (
                <Link key={v} href={searchHref(params, { sort: v })} className={params.sort === v ? "font-semibold" : t.muted}>
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {cards.length === 0 ? (
            <p className={`${t.muted} italic mb-8`}>
              Nothing matched{related.length ? " those words exactly — but these look related:" : ". Try fewer or different words — titles are terse on old paper."}
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">{cards}</div>
          )}

          {pages > 1 && (
            <nav className="flex flex-wrap items-center gap-2 mt-8 text-sm" aria-label="Pages">
              {params.page > 1 && (
                <Link href={searchHref(params, { page: params.page - 1 })} className={`px-3 py-1 rounded border ${t.chip}`}>
                  ← Previous
                </Link>
              )}
              <span className={t.muted}>
                Page {params.page} of {pages}
              </span>
              {params.page < pages && (
                <Link href={searchHref(params, { page: params.page + 1 })} className={`px-3 py-1 rounded border ${t.chip}`}>
                  Next →
                </Link>
              )}
            </nav>
          )}

          {related.length > 0 && (
            <div className="mt-12">
              {cards.length > 0 && <h2 className="text-xl font-semibold mb-4">Related</h2>}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">{related}</div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
