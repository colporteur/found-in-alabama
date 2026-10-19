// Site search (SEARCH-1) — the /search page's URL parameters, shared by
// both storefronts. Pure.

import type { SearchSort } from "./search";

export type SearchPageParams = {
  q: string;
  category: string;
  min: number | null;
  max: number | null;
  sort: SearchSort;
  page: number;
};

type SP = { [key: string]: string | string[] | undefined };
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
const num = (v: string): number | null => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function readSearchParams(sp: SP): SearchPageParams {
  const q = first(sp.q).slice(0, 120);
  const s = first(sp.sort);
  // The old TES links used sort=newest as the default; keep honouring it.
  const sort: SearchSort = s === "newest" || s === "price-asc" || s === "price-desc" ? s : q ? "best" : "newest";
  return {
    q,
    category: first(sp.category).replace(/[^0-9]/g, "").slice(0, 20),
    min: num(first(sp.min)),
    max: num(first(sp.max)),
    sort,
    page: Math.max(1, Math.min(200, parseInt(first(sp.page), 10) || 1)),
  };
}

/** /search?… with some parameters changed (page resets unless given). */
export function searchHref(p: SearchPageParams, change: Partial<SearchPageParams>): string {
  const n = { ...p, page: 1, ...change };
  const u = new URLSearchParams();
  if (n.q) u.set("q", n.q);
  if (n.category) u.set("category", n.category);
  if (n.min != null) u.set("min", String(n.min));
  if (n.max != null) u.set("max", String(n.max));
  if (n.sort !== (n.q ? "best" : "newest")) u.set("sort", n.sort);
  if (n.page > 1) u.set("page", String(n.page));
  const qs = u.toString();
  return `/search${qs ? `?${qs}` : ""}`;
}
