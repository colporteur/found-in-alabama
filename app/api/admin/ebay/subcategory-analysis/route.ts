// POST /api/admin/ebay/subcategory-analysis — propose store
// subcategories for a crowded category, from the actual listing titles.
//
// The analysis half of the subcategorizer tool: gathers titles from the
// mirror (the chosen store category, plus an optional keyword match to
// catch strays in Other), asks a strong model to cluster them into a
// collector-oriented taxonomy, and returns the proposal with estimated
// counts, example titles, and match hints. The proposal is what gets
// created as real eBay store categories and hard-coded into the Nifty
// BIN extension's listing-time category picker — assignment at the
// SOURCE, where recreates can't revert it.
//
// Body: { categoryId?: string, keyword?: string }  (at least one)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, ebayListings, ebayStoreCategories } from "@/db";
import { and, eq, gt, ilike, or, sql } from "drizzle-orm";
import { callLlm } from "@/lib/enhance/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TITLES = 1500;

const SYSTEM = `You design eBay Store category taxonomies for "Found in Alabama", a reseller of estate finds, vintage paper, books, and small antiques. Given real listing titles from ONE crowded store category, propose subcategories that would help buyers browse and help the seller assign categories at listing time.

Rules:
- Propose 5-12 subcategories. Every one must be justified by the titles actually present — no aspirational empty categories.
- Prefer collector-oriented splits (topic, region, era, format) over generic ones. Alabama/Southern material deserves its own subcategory when the titles support it.
- Short names buyers scan easily (2-4 words), no punctuation eBay store categories can't hold.
- Aim for reasonably balanced sizes; fold slivers into a broader sibling. Include one catch-all subcategory for the remainder.
- For each subcategory provide matchHints: lowercase keywords/phrases from the titles that would route an item there automatically.

Return ONLY JSON:
{
  "subcategories": [
    { "name": str, "estimatedCount": int, "exampleTitles": [str, str, str], "matchHints": [str, ...], "rationale": str }
  ],
  "notes": str
}`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { categoryId?: string; keyword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const categoryId = body.categoryId?.trim() || null;
  const keyword = body.keyword?.trim() || null;
  if (!categoryId && !keyword) {
    return NextResponse.json(
      { error: "Provide a categoryId, a keyword, or both" },
      { status: 400 }
    );
  }

  let categoryName: string | null = null;
  if (categoryId) {
    const [cat] = await db
      .select({ name: ebayStoreCategories.name })
      .from(ebayStoreCategories)
      .where(eq(ebayStoreCategories.categoryId, categoryId))
      .limit(1);
    categoryName = cat?.name ?? null;
  }

  // Titles: in the category (slot 1 or 2), plus keyword strays anywhere
  // (catches the Other-bucket members of the same product family).
  const matchers = [];
  if (categoryId) {
    matchers.push(
      or(
        eq(ebayListings.storeCategory1Id, categoryId),
        eq(ebayListings.storeCategory2Id, categoryId)
      )
    );
  }
  if (keyword) {
    matchers.push(ilike(ebayListings.title, `%${keyword.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  }

  const rows = await db
    .select({ title: ebayListings.title })
    .from(ebayListings)
    .where(and(gt(ebayListings.quantity, 0), or(...matchers)))
    .orderBy(sql`random()`)
    .limit(MAX_TITLES);

  if (rows.length < 30) {
    return NextResponse.json(
      { error: `Only ${rows.length} matching titles — too few to derive a taxonomy` },
      { status: 400 }
    );
  }

  const titleBlock = rows.map((r) => r.title).join("\n");
  const prompt = [
    categoryName
      ? `Store category being subdivided: "${categoryName}" (${rows.length} sampled titles${keyword ? `, including "${keyword}" matches from other categories` : ""}).`
      : `Listings matching "${keyword}" (${rows.length} sampled titles).`,
    `Titles:\n${titleBlock}`,
  ].join("\n\n");

  const llm = await callLlm({
    provider: "anthropic",
    model: "claude-sonnet-5",
    system: SYSTEM,
    prompt,
    maxTokens: 4000,
    op: "subcategory_analysis",
  });

  const start = llm.text.indexOf("{");
  const end = llm.text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return NextResponse.json(
      { error: `Model returned unparseable output: ${llm.text.slice(0, 200)}` },
      { status: 502 }
    );
  }
  let proposal: unknown;
  try {
    proposal = JSON.parse(llm.text.slice(start, end + 1));
  } catch {
    return NextResponse.json(
      { error: "Model JSON failed to parse — try again" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    categoryId,
    categoryName,
    keyword,
    sampleSize: rows.length,
    costUsd: llm.costUsd,
    proposal,
  });
}
