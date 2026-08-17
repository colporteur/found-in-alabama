// Auto-categorize dashboard. Replaces the old review-queue flow.
// Two phases: Primary (move out of "Other"), Secondary (add a 2nd
// category). Secondary is locked until Primary count = 0.

import Link from "next/link";
import { db } from "@/db";
import { ebayStoreCategories } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getLatestRun,
  getRunCategorizations,
} from "@/lib/ebay/auto-categorize";
import AutoCategorizeRunner from "./AutoCategorizeRunner";

export const dynamic = "force-dynamic";

export default async function AutoCategorizePage() {
  // Find the Other category and load category counts
  const [otherCat] = await db
    .select()
    .from(ebayStoreCategories)
    .where(eq(ebayStoreCategories.isOtherBucket, true))
    .limit(1);

  const latestRun = await getLatestRun();
  const recentResults = latestRun
    ? await getRunCategorizations(latestRun.id, 500)
    : [];

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            eBay tools · Auto-categorize
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">
            Categorize the &ldquo;Other&rdquo; pile
          </h1>
        </div>
        <Link
          href="/admin/ebay"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← eBay tools
        </Link>
      </div>

      {!otherCat && (
        <div className="mb-8 border-l-4 border-amber-400 bg-amber-50 p-4 rounded max-w-prose">
          <p className="font-medium mb-1">No &ldquo;Other&rdquo; category flagged yet.</p>
          <p className="text-sm text-brand-ink/80">
            Visit{" "}
            <Link
              href="/admin/ebay/categories"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              category sync
            </Link>{" "}
            and flag your &ldquo;Other&rdquo; bucket first. The auto-categorize
            tool uses that flag to know which listings need re-homing.
          </p>
        </div>
      )}

      <p className="text-brand-ink/70 mb-6 max-w-prose leading-relaxed">
        Pulls every active listing whose Store Category 1 is{" "}
        <em>{otherCat?.name ?? '"Other"'}</em>, asks Claude to pick a
        better-fitting Store category (weighted heavily toward your
        Alabama-flagged categories), and pushes the change to eBay
        immediately — no per-item approval. Items that have sold or ended
        since the snapshot are skipped with a clear marker. Items where
        Claude can&rsquo;t find a confident match get skipped too; you can
        re-run any time.
      </p>

      <AutoCategorizeRunner
        initialRun={
          latestRun
            ? {
                id: latestRun.id,
                phase: latestRun.phase,
                status: latestRun.status,
                initialQueueCount: latestRun.initialQueueCount ?? 0,
                queueIndex: latestRun.queueIndex,
                totalApplied: latestRun.totalApplied,
                totalFailed: latestRun.totalFailed,
                totalSkipped: latestRun.totalSkipped,
                startedAt:
                  latestRun.startedAt instanceof Date
                    ? latestRun.startedAt.toISOString()
                    : String(latestRun.startedAt),
                completedAt:
                  latestRun.completedAt instanceof Date
                    ? latestRun.completedAt.toISOString()
                    : latestRun.completedAt
                    ? String(latestRun.completedAt)
                    : null,
              }
            : null
        }
        initialResults={recentResults.map((r) => ({
          id: r.id,
          itemId: r.itemId,
          title: r.title,
          primaryImageUrl: r.primaryImageUrl,
          pickedCategory1Name: r.pickedCategory1Name,
          pickedCategory2Name: r.pickedCategory2Name,
          isAlabamaPick: r.isAlabamaPick,
          confidence: r.confidence ? Number(r.confidence) : null,
          reasoning: r.reasoning,
          outcome: r.outcome,
          errorMessage: r.errorMessage,
          decidedAt:
            r.decidedAt instanceof Date
              ? r.decidedAt.toISOString()
              : String(r.decidedAt),
        }))}
        otherFlagged={!!otherCat}
      />
    </section>
  );
}
