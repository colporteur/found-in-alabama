// POST /api/admin/ebay/suggestions/decide
// Body: { suggestionId: string, decision: "apply" | "skip" | "reject", overrideCategory1Id?: string, overrideCategory2Id?: string | null }
//
// Records the user's decision on a single suggestion. For "apply", we also
// call eBay's ReviseItem to actually move the listing to the new category,
// then update the cached listing row to reflect the new state.
//
// Apply path is the only one that hits eBay; skip and reject are local
// state changes only. The cached listing row is also refreshed for apply.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  ebayCategorySuggestions,
  ebayListings,
  ebaySyncLog,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { reviseStoreCategories } from "@/lib/ebay/calls";

export const runtime = "nodejs";
export const maxDuration = 30;

interface DecisionBody {
  suggestionId?: string;
  decision?: "apply" | "skip" | "reject";
  overrideCategory1Id?: string | null;
  overrideCategory2Id?: string | null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body: DecisionBody = await req.json().catch(() => ({}));
  const { suggestionId, decision } = body;

  if (!suggestionId || typeof suggestionId !== "string") {
    return NextResponse.json(
      { ok: false, error: "suggestionId required" },
      { status: 400 }
    );
  }
  if (decision !== "apply" && decision !== "skip" && decision !== "reject") {
    return NextResponse.json(
      { ok: false, error: "decision must be apply | skip | reject" },
      { status: 400 }
    );
  }

  const start = Date.now();

  try {
    const [suggestion] = await db
      .select()
      .from(ebayCategorySuggestions)
      .where(eq(ebayCategorySuggestions.id, suggestionId))
      .limit(1);

    if (!suggestion) {
      return NextResponse.json(
        { ok: false, error: "Suggestion not found" },
        { status: 404 }
      );
    }

    if (decision === "skip" || decision === "reject") {
      await db
        .update(ebayCategorySuggestions)
        .set({ status: decision === "skip" ? "skipped" : "rejected", decidedAt: new Date() })
        .where(eq(ebayCategorySuggestions.id, suggestionId));
      return NextResponse.json({
        ok: true,
        decision,
        durationMs: Date.now() - start,
      });
    }

    // decision === "apply" — push to eBay, then update local cache.
    const cat1Id =
      body.overrideCategory1Id !== undefined
        ? body.overrideCategory1Id
        : suggestion.suggestedCategory1Id;
    const cat2Id =
      body.overrideCategory2Id !== undefined
        ? body.overrideCategory2Id
        : suggestion.suggestedCategory2Id;

    if (!cat1Id) {
      return NextResponse.json(
        {
          ok: false,
          error: "No primary category to apply. Use override or skip instead.",
        },
        { status: 400 }
      );
    }

    await reviseStoreCategories(suggestion.itemId, cat1Id, cat2Id ?? "");

    await db
      .update(ebayListings)
      .set({
        storeCategory1Id: cat1Id,
        storeCategory2Id: cat2Id ?? null,
        lastSyncedAt: new Date(),
      })
      .where(eq(ebayListings.itemId, suggestion.itemId));

    await db
      .update(ebayCategorySuggestions)
      .set({
        status: "applied",
        decidedAt: new Date(),
        // Persist any user overrides so the audit log reflects what was sent.
        suggestedCategory1Id: cat1Id,
        suggestedCategory2Id: cat2Id ?? null,
      })
      .where(eq(ebayCategorySuggestions.id, suggestionId));

    await db.insert(ebaySyncLog).values({
      action: "revise-item",
      itemId: suggestion.itemId,
      success: true,
      details: {
        suggestionId,
        cat1Id,
        cat2Id: cat2Id ?? null,
      },
      startedAt: new Date(start),
      endedAt: new Date(),
    });

    return NextResponse.json({
      ok: true,
      decision: "apply",
      itemId: suggestion.itemId,
      cat1Id,
      cat2Id: cat2Id ?? null,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const message = (err as Error).message;
    await db
      .insert(ebaySyncLog)
      .values({
        action: "revise-item",
        success: false,
        errorMessage: message,
        details: { suggestionId, decision },
        startedAt: new Date(start),
        endedAt: new Date(),
      })
      .catch(() => {});
    return NextResponse.json(
      { ok: false, error: message, durationMs: Date.now() - start },
      { status: 500 }
    );
  }
}
