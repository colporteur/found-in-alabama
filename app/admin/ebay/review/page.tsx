// Step 3 of the eBay tool: Claude reviews each cached listing and suggests
// a better-fitting store category, with extra weight on Alabama-flagged
// targets. The user approves, edits, or skips each suggestion; approvals
// hit eBay's ReviseItem and update the listing in place.

import Link from "next/link";
import { db } from "@/db";
import {
  ebayCategorySuggestions,
  ebayListings,
  ebayStoreCategories,
} from "@/db/schema";
import { count, desc, eq, and, sql } from "drizzle-orm";
import ReviewQueue from "./ReviewQueue";

export const dynamic = "force-dynamic";

export interface CategoryOptionDTO {
  id: string;
  name: string;
  isAlabama: boolean;
}

export interface SuggestionRow {
  suggestionId: string;
  itemId: string;
  title: string;
  primaryImageUrl: string | null;
  currentCategory1Id: string | null;
  currentCategory1Name: string | null;
  suggestedCategory1Id: string | null;
  suggestedCategory1Name: string | null;
  suggestedCategory2Id: string | null;
  suggestedCategory2Name: string | null;
  confidence: number;
  reasoning: string | null;
  status: "pending" | "auto-applied" | "applied" | "skipped" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  price: string | null;
  ebayUrl: string;
}

export default async function ReviewPage() {
  // All eligible categories for the dropdown UI (everything except the
  // Other bucket itself).
  const allCats = await db
    .select({
      id: ebayStoreCategories.categoryId,
      name: ebayStoreCategories.name,
      isAlabama: ebayStoreCategories.isAlabamaRelated,
      isOtherBucket: ebayStoreCategories.isOtherBucket,
    })
    .from(ebayStoreCategories);

  const categoryOptions: CategoryOptionDTO[] = allCats
    .filter((c) => !c.isOtherBucket)
    .map((c) => ({ id: c.id, name: c.name, isAlabama: c.isAlabama }));

  const nameById = new Map(allCats.map((c) => [c.id, c.name] as const));

  // Counts by status for the summary header.
  const statusCounts = await db
    .select({
      status: ebayCategorySuggestions.status,
      count: count(),
    })
    .from(ebayCategorySuggestions)
    .groupBy(ebayCategorySuggestions.status);

  const totalListings = (
    await db.select({ count: count() }).from(ebayListings)
  )[0]?.count ?? 0;
  const totalSuggestions = (
    await db
      .select({ count: count() })
      .from(ebayCategorySuggestions)
  )[0]?.count ?? 0;

  // Pull pending suggestions, sorted by confidence ascending so the most
  // uncertain ones land first — those are where human review pays off most.
  const rows = await db
    .select({
      suggestionId: ebayCategorySuggestions.id,
      itemId: ebayCategorySuggestions.itemId,
      title: ebayListings.title,
      primaryImageUrl: ebayListings.primaryImageUrl,
      price: ebayListings.price,
      currentCategory1Id: ebayListings.storeCategory1Id,
      suggestedCategory1Id: ebayCategorySuggestions.suggestedCategory1Id,
      suggestedCategory2Id: ebayCategorySuggestions.suggestedCategory2Id,
      confidence: ebayCategorySuggestions.confidence,
      reasoning: ebayCategorySuggestions.reasoning,
      status: ebayCategorySuggestions.status,
      createdAt: ebayCategorySuggestions.createdAt,
      decidedAt: ebayCategorySuggestions.decidedAt,
    })
    .from(ebayCategorySuggestions)
    .innerJoin(
      ebayListings,
      eq(ebayCategorySuggestions.itemId, ebayListings.itemId)
    )
    .where(eq(ebayCategorySuggestions.status, "pending"))
    .orderBy(sql`${ebayCategorySuggestions.confidence} desc`)
    .limit(100);

  const queue: SuggestionRow[] = rows.map((r) => ({
    suggestionId: r.suggestionId,
    itemId: r.itemId,
    title: r.title,
    primaryImageUrl: r.primaryImageUrl,
    price: r.price,
    currentCategory1Id: r.currentCategory1Id,
    currentCategory1Name: r.currentCategory1Id
      ? nameById.get(r.currentCategory1Id) ?? null
      : null,
    suggestedCategory1Id: r.suggestedCategory1Id,
    suggestedCategory1Name: r.suggestedCategory1Id
      ? nameById.get(r.suggestedCategory1Id) ?? null
      : null,
    suggestedCategory2Id: r.suggestedCategory2Id,
    suggestedCategory2Name: r.suggestedCategory2Id
      ? nameById.get(r.suggestedCategory2Id) ?? null
      : null,
    confidence: Number(r.confidence),
    reasoning: r.reasoning,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    ebayUrl: `https://www.ebay.com/itm/${r.itemId}`,
  }));

  const counts = {
    listings: totalListings,
    total: totalSuggestions,
    pending: statusCounts.find((s) => s.status === "pending")?.count ?? 0,
    applied:
      (statusCounts.find((s) => s.status === "applied")?.count ?? 0) +
      (statusCounts.find((s) => s.status === "auto-applied")?.count ?? 0),
    skipped: statusCounts.find((s) => s.status === "skipped")?.count ?? 0,
    rejected: statusCounts.find((s) => s.status === "rejected")?.count ?? 0,
  };

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        eBay tools · Step 3
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">
        Review &amp; approve suggestions
      </h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Claude scores each cached listing against your store categories,
        with extra weight on Alabama-flagged ones. Approve to push the
        change to eBay, edit if Claude got close but not perfect, or skip
        to leave the listing where it is.
      </p>

      <ReviewQueue
        initialQueue={queue}
        counts={counts}
        categoryOptions={categoryOptions}
      />

      <div className="mt-10">
        <Link
          href="/admin/ebay"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Back to eBay tools
        </Link>
      </div>
    </section>
  );
}
