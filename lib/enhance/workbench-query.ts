// Shared workbench filter builder — used by the workbench page AND the
// item-ids endpoint so "select all matching filter" resolves EXACTLY the
// same set the user is looking at.

import { eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { ebayListings } from "@/db/schema";
import {
  SKU_CLASSES,
  skuClassSql,
  skuNumericSql,
  type SkuClass,
} from "@/lib/enhance/sku-class";

export type WorkbenchParams = {
  q?: string;
  skuClass?: string;
  /** Class-aware SKU number range: NA bins by bin #, media/vinyl by
   *  YYMMDD date, LT by main number, cards by leading id. */
  skuNumFrom?: string;
  skuNumTo?: string;
  categoryId?: string;
  priceMin?: string;
  priceMax?: string;
  wiggle?: string; // "never" | "30" | "60" | "90"
  subst?: string;
};

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function ageFilter(
  column: typeof ebayListings.lastWiggleAt | typeof ebayListings.lastSubstantiveAt,
  value: string | undefined
): SQL | undefined {
  if (!value) return undefined;
  if (value === "never") return sql`${column} IS NULL`;
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return undefined;
  return sql`(${column} IS NULL OR ${column} < now() - make_interval(days => ${days}))`;
}

/** All active filters from the params, ready for and(...). */
export function workbenchFilters(p: WorkbenchParams): SQL[] {
  const filters: (SQL | undefined)[] = [];
  if (p.q) {
    const like = `%${escapeLike(p.q)}%`;
    filters.push(or(ilike(ebayListings.title, like), ilike(ebayListings.sku, like)));
  }
  const skuClass = (SKU_CLASSES as readonly string[]).includes(p.skuClass ?? "")
    ? (p.skuClass as SkuClass)
    : "";
  if (skuClass) filters.push(sql`(${skuClassSql()}) = ${skuClass}`);
  if (p.skuNumFrom && Number.isFinite(Number(p.skuNumFrom))) {
    filters.push(sql`(${skuNumericSql()}) >= ${Number(p.skuNumFrom)}`);
  }
  if (p.skuNumTo && Number.isFinite(Number(p.skuNumTo))) {
    filters.push(sql`(${skuNumericSql()}) <= ${Number(p.skuNumTo)}`);
  }
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
  return filters.filter((f): f is SQL => f !== undefined);
}
