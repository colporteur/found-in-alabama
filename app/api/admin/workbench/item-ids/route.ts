// GET /api/admin/workbench/item-ids — resolve the item IDs matching the
// current workbench filters, for "apply to ALL matching" in the apply
// modal. Same filter builder as the page, so the sets always agree.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, ebayListings } from "@/db";
import { and, asc, sql } from "drizzle-orm";
import { workbenchFilters, type WorkbenchParams } from "@/lib/enhance/workbench-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAP = 5000;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const params: WorkbenchParams = {
    q: sp.get("q") ?? undefined,
    skuClass: sp.get("skuClass") ?? undefined,
    skuNumFrom: sp.get("skuNumFrom") ?? undefined,
    skuNumTo: sp.get("skuNumTo") ?? undefined,
    categoryId: sp.get("categoryId") ?? undefined,
    priceMin: sp.get("priceMin") ?? undefined,
    priceMax: sp.get("priceMax") ?? undefined,
    wiggle: sp.get("wiggle") ?? undefined,
    subst: sp.get("subst") ?? undefined,
  };

  const filters = workbenchFilters(params);
  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const [rows, [countRow]] = await Promise.all([
    db
      .select({ itemId: ebayListings.itemId })
      .from(ebayListings)
      .where(whereClause)
      .orderBy(asc(ebayListings.itemId))
      .limit(CAP),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(ebayListings)
      .where(whereClause),
  ]);

  const total = countRow?.n ?? 0;
  return NextResponse.json({
    itemIds: rows.map((r) => r.itemId),
    total,
    capped: total > CAP,
  });
}
