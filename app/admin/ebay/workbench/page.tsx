// /admin/ebay/workbench — the inventory workbench (Phase W1: read-only
// chart). Every active eBay listing from the mirror with thumbnail,
// title, SKU (+ schema class), price, and the last-wiggle /
// last-substantive action dates, with filtering, sorting, and
// pagination. Phase W2 adds the checkbox action layer.

import { db, ebayListings, ebayStoreCategories } from "@/db";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import Link from "next/link";
import { decodeEntities } from "@/lib/ebay/entities";
import {
  SKU_CLASSES,
  SKU_CLASS_LABELS,
  skuClassSql,
  skuNaturalOrderSql,
  type SkuClass,
} from "@/lib/enhance/sku-class";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

type Params = {
  q?: string;
  skuClass?: string;
  categoryId?: string;
  priceMin?: string;
  priceMax?: string;
  wiggle?: string; // "never" | "30" | "60" | "90"
  subst?: string;
  sort?: string; // "sku" | "title" | "price" | "wiggle" | "subst" | "synced"
  dir?: string; // "asc" | "desc"
  page?: string;
};

const AGE_CHOICES = ["", "never", "30", "60", "90"] as const;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function ageFilter(
  column: AnyPgColumn,
  value: string | undefined
): SQL | undefined {
  if (!value) return undefined;
  if (value === "never") return sql`${column} IS NULL`;
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return undefined;
  return sql`(${column} IS NULL OR ${column} < now() - make_interval(days => ${days}))`;
}

function buildHref(base: Params, patch: Partial<Params>): string {
  const merged: Record<string, string | undefined> = { ...base, ...patch };
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v) usp.set(k, v);
  }
  const qs = usp.toString();
  return qs ? `/admin/ebay/workbench?${qs}` : "/admin/ebay/workbench";
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

  // ── Filters ──
  const filters: (SQL | undefined)[] = [];
  if (p.q) {
    const like = `%${escapeLike(p.q)}%`;
    filters.push(or(ilike(ebayListings.title, like), ilike(ebayListings.sku, like)));
  }
  if (skuClass) filters.push(sql`(${skuClassSql()}) = ${skuClass}`);
  if (p.categoryId) {
    filters.push(
      or(
        eq(ebayListings.storeCategory1Id, p.categoryId),
        eq(ebayListings.storeCategory2Id, p.categoryId)
      )
    );
  }
  if (p.priceMin && Number.isFinite(Number(p.priceMin))) {
    filters.push(sql`${ebayListings.price} >= ${Number(p.priceMin)}`);
  }
  if (p.priceMax && Number.isFinite(Number(p.priceMax))) {
    filters.push(sql`${ebayListings.price} <= ${Number(p.priceMax)}`);
  }
  filters.push(ageFilter(ebayListings.lastWiggleAt, p.wiggle));
  filters.push(ageFilter(ebayListings.lastSubstantiveAt, p.subst));
  const active = filters.filter((f): f is SQL => f !== undefined);
  const whereClause = active.length > 0 ? and(...active) : undefined;

  // ── Sorting ──
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
      : sort === "synced"
      ? [direction(ebayListings.lastSyncedAt) as unknown as SQL]
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

  const sortLink = (key: string, label: string) => {
    const nextDir = sort === key && dir === "asc" ? "desc" : "asc";
    return (
      <Link
        href={buildHref(p, { sort: key, dir: nextDir, page: "" })}
        className="hover:underline underline-offset-2 decoration-brand-yellow decoration-2"
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
        All active eBay inventory with SKU schema classes and the date each
        item last got a wiggle (price/SKU) or a substantive change (AI ops,
        price research). Checkbox actions arrive in the next stage.
      </p>

      {/* ── Filter bar ── */}
      <form method="GET" className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-6">
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
        <div className="flex items-center gap-3 mt-3">
          <button
            type="submit"
            className="bg-brand-ink text-brand-paper hover:bg-brand-ink/85 rounded px-4 py-1.5 text-sm"
          >
            Filter
          </button>
          <Link href="/admin/ebay/workbench" className="text-sm text-brand-ink/60 hover:underline">
            Reset
          </Link>
          <span className="text-sm text-brand-ink/50 ml-auto">
            {total.toLocaleString()} listing{total === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      {/* ── Grid ── */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-brand-ink/40">
              <th className="pb-2 pr-3"></th>
              <th className="pb-2 pr-4">{sortLink("title", "Title")}</th>
              <th className="pb-2 pr-4">{sortLink("sku", "SKU")}</th>
              <th className="pb-2 pr-4">Class</th>
              <th className="pb-2 pr-4 text-right">{sortLink("price", "Price")}</th>
              <th className="pb-2 pr-4">{sortLink("wiggle", "Last wiggle")}</th>
              <th className="pb-2">{sortLink("subst", "Last substantive")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.itemId} className="border-t border-brand-ink/5">
                <td className="py-1.5 pr-3">
                  {r.primaryImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.primaryImageUrl.replace(/s-l\d+/i, "s-l140")}
                      alt=""
                      className="w-12 h-12 object-cover rounded border border-brand-ink/10"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded bg-brand-ink/5" />
                  )}
                </td>
                <td className="py-1.5 pr-4 max-w-md">
                  <a
                    href={`https://www.ebay.com/itm/${r.itemId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline underline-offset-2 decoration-brand-yellow decoration-2"
                  >
                    <span className="block truncate">{decodeEntities(r.title)}</span>
                  </a>
                </td>
                <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap">
                  {r.sku ?? "—"}
                </td>
                <td className="py-1.5 pr-4 whitespace-nowrap">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      r.skuClass === "irregular" || r.skuClass === "none"
                        ? "bg-red-100 text-red-800"
                        : "bg-brand-ink/5 text-brand-ink/70"
                    }`}
                  >
                    {SKU_CLASS_LABELS[r.skuClass]}
                  </span>
                </td>
                <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                  {r.price ? `$${Number(r.price).toFixed(2)}` : "—"}
                </td>
                <td className="py-1.5 pr-4 whitespace-nowrap text-xs">
                  {fmtDate(r.lastWiggleAt) ?? (
                    <span className="text-brand-ink/40">never</span>
                  )}
                </td>
                <td className="py-1.5 whitespace-nowrap text-xs">
                  {fmtDate(r.lastSubstantiveAt) ?? (
                    <span className="text-brand-ink/40">never</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-brand-ink/50">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
