// /admin/ebay/workbench — the inventory workbench. W1: chart with SKU
// schema classes, last-action tracking, filters/sorting/pagination.
// W2: checkbox action layer (WorkbenchGrid) that turns selections into
// Expert Enhance batches.

import { db, ebayListings, ebayStoreCategories } from "@/db";
import { and, asc, desc, sql, type SQL } from "drizzle-orm";
import Link from "next/link";
import { decodeEntities } from "@/lib/ebay/entities";
import { listGuides } from "@/lib/enhance/guides";
import {
  SKU_CLASSES,
  SKU_CLASS_LABELS,
  skuClassSql,
  skuNaturalOrderSql,
  type SkuClass,
} from "@/lib/enhance/sku-class";
import {
  workbenchFilters,
  type WorkbenchParams,
} from "@/lib/enhance/workbench-query";
import WorkbenchGrid, { type GridRow } from "./WorkbenchGrid";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

type Params = WorkbenchParams & {
  sort?: string; // "sku" | "title" | "price" | "wiggle" | "subst"
  dir?: string;
  page?: string;
};

const AGE_CHOICES = ["", "never", "30", "60", "90"] as const;

function buildHref(base: Params, patch: Partial<Params>): string {
  const merged: Record<string, string | undefined> = { ...base, ...patch };
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v) usp.set(k, v);
  }
  const qs = usp.toString();
  return qs ? `/admin/ebay/workbench?${qs}` : "/admin/ebay/workbench";
}

function filterQueryString(p: Params): string {
  const usp = new URLSearchParams();
  for (const k of ["q", "skuClass", "skuNumFrom", "skuNumTo", "categoryId", "priceMin", "priceMax", "wiggle", "subst"] as const) {
    if (p[k]) usp.set(k, p[k]!);
  }
  return usp.toString();
}

const fmtDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
        timeZone: "America/Chicago",
      })
    : null;

export default async function Workbench({
  searchParams,
}: {
  searchParams: Params;
}) {
  const p = searchParams;
  const page = Math.max(1, Number(p.page) || 1);
  const dir = p.dir === "desc" ? "desc" : "asc";
  const sort = p.sort ?? "sku";
  const skuClass = (SKU_CLASSES as readonly string[]).includes(p.skuClass ?? "")
    ? (p.skuClass as SkuClass)
    : "";

  const active = workbenchFilters(p);
  const whereClause = active.length > 0 ? and(...active) : undefined;

  const direction = dir === "desc" ? desc : asc;
  const orderBy: SQL[] =
    sort === "title"
      ? [direction(ebayListings.title) as unknown as SQL]
      : sort === "price"
      ? [sql`${ebayListings.price} ${sql.raw(dir)} NULLS LAST`]
      : sort === "wiggle"
      ? [sql`${ebayListings.lastWiggleAt} ${sql.raw(dir)} NULLS FIRST`]
      : sort === "subst"
      ? [sql`${ebayListings.lastSubstantiveAt} ${sql.raw(dir)} NULLS FIRST`]
      : dir === "desc"
      ? skuNaturalOrderSql().map((s) => sql`${s} DESC`)
      : skuNaturalOrderSql();

  const [rows, [countRow], categories, classCounts] = await Promise.all([
    db
      .select({
        itemId: ebayListings.itemId,
        sku: ebayListings.sku,
        title: ebayListings.title,
        price: ebayListings.price,
        primaryImageUrl: ebayListings.primaryImageUrl,
        lastWiggleAt: ebayListings.lastWiggleAt,
        lastSubstantiveAt: ebayListings.lastSubstantiveAt,
        skuClass: skuClassSql(),
      })
      .from(ebayListings)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(ebayListings)
      .where(whereClause),
    db
      .select({
        categoryId: ebayStoreCategories.categoryId,
        name: ebayStoreCategories.name,
      })
      .from(ebayStoreCategories)
      .orderBy(asc(ebayStoreCategories.name)),
    db
      .select({ cls: skuClassSql(), n: sql<number>`count(*)::int` })
      .from(ebayListings)
      .groupBy(skuClassSql()),
  ]);

  const total = countRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const countByClass = new Map(classCounts.map((c) => [c.cls, c.n]));

  const gridRows: GridRow[] = rows.map((r) => ({
    itemId: r.itemId,
    sku: r.sku,
    title: decodeEntities(r.title),
    price: r.price,
    thumb: r.primaryImageUrl
      ? r.primaryImageUrl.replace(/s-l\d+/i, "s-l140")
      : null,
    skuClass: r.skuClass,
    skuClassLabel: SKU_CLASS_LABELS[r.skuClass],
    lastWiggle: fmtDate(r.lastWiggleAt),
    lastSubstantive: fmtDate(r.lastSubstantiveAt),
  }));

  const sortLink = (key: string, label: string) => {
    const nextDir = sort === key && dir === "asc" ? "desc" : "asc";
    return (
      <Link
        key={key}
        href={buildHref(p, { sort: key, dir: nextDir, page: "" })}
        className={`hover:underline underline-offset-2 decoration-brand-yellow decoration-2 ${
          sort === key ? "font-medium" : "text-brand-ink/60"
        }`}
      >
        {label}
        {sort === key ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </Link>
    );
  };

  const inputCls =
    "border border-brand-ink/20 rounded px-2 py-1.5 text-sm bg-white";
  const labelCls = "block text-xs uppercase tracking-wider text-brand-ink/50 mb-1";

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        eBay tools
      </p>
      <div className="flex items-baseline justify-between flex-wrap gap-4 mb-2">
        <h1 className="font-marker text-4xl">Workbench</h1>
        <Link
          href="/admin/ebay/enhance"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Expert Enhance dashboard →
        </Link>
      </div>
      <p className="text-brand-ink/70 mb-8 max-w-2xl">
        Check items for wiggles (price/SKU) or substantive changes (AI ops,
        price research), then apply — each op becomes a batch on the enhance
        queue.
      </p>

      {/* ── Filter bar ── */}
      <form method="GET" className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <div className="sm:col-span-2">
            <label className={labelCls}>Search title / SKU</label>
            <input className={`${inputCls} w-full`} name="q" defaultValue={p.q ?? ""} />
          </div>
          <div>
            <label className={labelCls}>SKU class</label>
            <select className={`${inputCls} w-full`} name="skuClass" defaultValue={skuClass}>
              <option value="">All</option>
              {SKU_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {SKU_CLASS_LABELS[c]} ({countByClass.get(c) ?? 0})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} title="Bin/jewelry/LT number, YYMMDD date for media & vinyl, card id">
              SKU # / date range
            </label>
            <div className="flex gap-1">
              <input className={`${inputCls} w-full`} name="skuNumFrom" placeholder="59 / NA59" defaultValue={p.skuNumFrom ?? ""} />
              <input className={`${inputCls} w-full`} name="skuNumTo" placeholder="100 / NA100" defaultValue={p.skuNumTo ?? ""} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Store category</label>
            <select className={`${inputCls} w-full`} name="categoryId" defaultValue={p.categoryId ?? ""}>
              <option value="">Any</option>
              {categories.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Price $</label>
            <div className="flex gap-1">
              <input className={`${inputCls} w-full`} name="priceMin" placeholder="min" defaultValue={p.priceMin ?? ""} inputMode="decimal" />
              <input className={`${inputCls} w-full`} name="priceMax" placeholder="max" defaultValue={p.priceMax ?? ""} inputMode="decimal" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Wiggled</label>
            <select className={`${inputCls} w-full`} name="wiggle" defaultValue={p.wiggle ?? ""}>
              {AGE_CHOICES.map((a) => (
                <option key={a || "any"} value={a}>
                  {a === "" ? "Any" : a === "never" ? "Never" : `Not in ${a}+ days`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Substantive</label>
            <select className={`${inputCls} w-full`} name="subst" defaultValue={p.subst ?? ""}>
              {AGE_CHOICES.map((a) => (
                <option key={a || "any"} value={a}>
                  {a === "" ? "Any" : a === "never" ? "Never" : `Not in ${a}+ days`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <button
            type="submit"
            className="bg-brand-ink text-brand-paper hover:bg-brand-ink/85 rounded px-4 py-1.5 text-sm"
          >
            Filter
          </button>
          <Link href="/admin/ebay/workbench" className="text-sm text-brand-ink/60 hover:underline">
            Reset
          </Link>
          <span className="text-sm text-brand-ink/60 flex items-center gap-3 ml-2">
            Sort:
            {sortLink("sku", "SKU")}
            {sortLink("title", "Title")}
            {sortLink("price", "Price")}
            {sortLink("wiggle", "Last wiggle")}
            {sortLink("subst", "Last substantive")}
          </span>
          <span className="text-sm text-brand-ink/50 ml-auto">
            {total.toLocaleString()} listing{total === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      <WorkbenchGrid
        rows={gridRows}
        guides={listGuides().map((g) => ({ id: g.id, name: g.name }))}
        filterQuery={filterQueryString(p)}
        matchingTotal={total}
      />

      {/* ── Pagination ── */}
      {pages > 1 && (
        <div className="flex items-center gap-3 mt-4 text-sm">
          {page > 1 && (
            <Link
              href={buildHref(p, { page: String(page - 1) })}
              className="hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
            >
              ← Prev
            </Link>
          )}
          <span className="text-brand-ink/50">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link
              href={buildHref(p, { page: String(page + 1) })}
              className="hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
            >
              Next →
            </Link>
          )}
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-brand-ink/10">
        <Link
          href="/admin/ebay"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          ← Back to eBay tools
        </Link>
      </div>
    </section>
  );
}
