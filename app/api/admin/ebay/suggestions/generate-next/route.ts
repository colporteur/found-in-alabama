// POST /api/admin/ebay/suggestions/generate-next
// Body: { batchSize?: number }  // default 3, max 5
//
// Picks the next N cached listings that don't yet have a suggestion, asks
// Claude to score each one against the seller's store categories
// (with Alabama-flagged ones boosted in the prompt), and inserts the
// resulting suggestion rows. Returns a count of remaining listings so the
// client can drive the loop without ever risking a function timeout.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  ebayCategorySuggestions,
  ebayListings,
  ebayStoreCategories,
} from "@/db/schema";
import { count, eq, sql } from "drizzle-orm";
import { suggestCategoryForListing } from "@/lib/ebay/categorize";
import { decodeEntities } from "@/lib/ebay/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  batchSize?: number;
}

interface BatchResult {
  ok: boolean;
  processed: number;
  remaining: number;
  hasMore: boolean;
  failures: Array<{ itemId: string; error: string }>;
  durationMs: number;
  error?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body: Body = await req.json().catch(() => ({}));
  const batchSize = Math.min(5, Math.max(1, Number(body.batchSize) || 3));
  const start = Date.now();

  try {
    // Eligible categories: anything in the synced tree EXCEPT the "Other"
    // bucket itself (suggesting "Other → Other" would be silly).
    const cats = await db
      .select({
        id: ebayStoreCategories.categoryId,
        name: ebayStoreCategories.name,
        isAlabama: ebayStoreCategories.isAlabamaRelated,
        isOtherBucket: ebayStoreCategories.isOtherBucket,
      })
      .from(ebayStoreCategories);
    const eligible = cats
      .filter((c) => !c.isOtherBucket)
      .map((c) => ({ id: c.id, name: c.name, isAlabama: c.isAlabama }));

    // Find the next batch of listings without an existing suggestion. We
    // use a NOT EXISTS subquery so re-running is idempotent. Also skip
    // zero-quantity listings — eBay keeps sold-out items active for ~90
    // days but recategorizing them is wasted Claude calls.
    const listings = await db
      .select({
        itemId: ebayListings.itemId,
        title: ebayListings.title,
        primaryImageUrl: ebayListings.primaryImageUrl,
      })
      .from(ebayListings)
      .where(
        sql`not exists (select 1 from ${ebayCategorySuggestions} s where s.item_id = ${ebayListings.itemId})
            and coalesce(${ebayListings.quantity}, 0) > 0`
      )
      .limit(batchSize);

    if (listings.length === 0) {
      const result: BatchResult = {
        ok: true,
        processed: 0,
        remaining: 0,
        hasMore: false,
        failures: [],
        durationMs: Date.now() - start,
      };
      return NextResponse.json(result);
    }

    const failures: Array<{ itemId: string; error: string }> = [];
    let processed = 0;

    // Process sequentially to keep within the function timeout and avoid
    // hitting Anthropic rate limits. Each call typically takes 2-4s.
    for (const listing of listings) {
      try {
        const suggestion = await suggestCategoryForListing({
          title: decodeEntities(listing.title),
          imageUrl: listing.primaryImageUrl,
          categories: eligible,
        });

        await db.insert(ebayCategorySuggestions).values({
          itemId: listing.itemId,
          suggestedCategory1Id: suggestion.primaryCategoryId,
          suggestedCategory2Id: suggestion.secondaryCategoryId,
          confidence: String(suggestion.confidence),
          reasoning: suggestion.reasoning,
          status: "pending",
        });
        processed++;
      } catch (err) {
        failures.push({
          itemId: listing.itemId,
          error: (err as Error).message,
        });
      }
    }

    const [{ count: remainingCount } = { count: 0 }] = await db
      .select({ count: count() })
      .from(ebayListings)
      .where(
        sql`not exists (select 1 from ${ebayCategorySuggestions} s where s.item_id = ${ebayListings.itemId})
            and coalesce(${ebayListings.quantity}, 0) > 0`
      );

    const result: BatchResult = {
      ok: true,
      processed,
      remaining: remainingCount,
      hasMore: remainingCount > 0,
      failures,
      durationMs: Date.now() - start,
    };
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        processed: 0,
        remaining: 0,
        hasMore: false,
        failures: [],
        durationMs: Date.now() - start,
      },
      { status: 500 }
    );
  }
}
