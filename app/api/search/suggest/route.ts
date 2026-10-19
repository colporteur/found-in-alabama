// GET /api/search/suggest?q=birm&site=fia|tes — suggestions as you type
// for the header search box (SEARCH-1): matching shelves and items.
// Public, read-only; cached briefly at the edge.

import { NextRequest, NextResponse } from "next/server";
import { suggest } from "@/lib/search/search";
import { searchReady } from "@/lib/search/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  const site = req.nextUrl.searchParams.get("site") === "tes" ? "tes" : "fia";
  if (q.trim().length < 2 || !(await searchReady().catch(() => false))) {
    return NextResponse.json({ categories: [], items: [] });
  }
  try {
    const out = await suggest(q, site);
    return NextResponse.json(out, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ categories: [], items: [] });
  }
}
