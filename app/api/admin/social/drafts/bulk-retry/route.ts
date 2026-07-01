// POST /api/admin/social/drafts/bulk-retry
//
// Re-runs postDraft() against every draft with status="failed", optionally
// filtered to one channel, up to a batch limit. Written for the case where
// a fix landed (e.g. missing OAuth scope, expired token, adapter bug) that
// invalidated a big backlog of failed drafts — hitting this endpoint from
// the Failed tab burns through the backlog N at a time.
//
// Body:
//   { channel?: string   — filter to one channel (e.g. "pinterest")
//     limit?: number     — how many to retry this call (default 10, cap 20)
//   }
//
// Returns:
//   { attempted, succeeded, failed, remaining, samples: string[] }
// where `samples` is the first few error messages so the UI can display
// them without a full follow-up query.
//
// Each retry is fully synchronous: postDraft → DB write → next. That keeps
// state consistent even if the request is cancelled mid-batch, but caps
// how many can go in one 60s Vercel invocation.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, socialDrafts } from "@/db";
import { and, asc, eq } from "drizzle-orm";
import { postDraft } from "@/lib/posting";
import type { ChannelKey } from "@/lib/social/channel-styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

type Body = {
  channel?: string;
  limit?: number;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(body.limit) || DEFAULT_LIMIT)
  );
  const channel = typeof body.channel === "string" ? body.channel : null;

  const whereClause = channel
    ? and(eq(socialDrafts.status, "failed"), eq(socialDrafts.channel, channel))
    : eq(socialDrafts.status, "failed");

  const batch = await db
    .select()
    .from(socialDrafts)
    .where(whereClause)
    .orderBy(asc(socialDrafts.updatedAt))
    .limit(limit);

  let succeeded = 0;
  let failed = 0;
  const errorSamples: string[] = [];

  for (const draft of batch) {
    const result = await postDraft({
      channel: draft.channel as ChannelKey,
      content: draft.content as Record<string, unknown>,
      sourceImage: draft.sourceImage,
      sourceTitle: draft.sourceTitle,
      sourceUrl: draft.sourceUrl ?? null,
    });

    type DraftPatch = Partial<typeof socialDrafts.$inferInsert>;
    const commonFields: DraftPatch = {
      attemptCount: (draft.attemptCount ?? 0) + 1,
      lastAttemptAt: new Date(),
      updatedAt: new Date(),
    };

    if (result.ok) {
      await db
        .update(socialDrafts)
        .set({
          ...commonFields,
          status: "posted",
          postedAt: new Date(),
          postId: result.postId,
          postUrl: result.postUrl,
          postError: null,
        })
        .where(eq(socialDrafts.id, draft.id));
      succeeded++;
    } else {
      await db
        .update(socialDrafts)
        .set({
          ...commonFields,
          status: "failed",
          postError: result.error,
        })
        .where(eq(socialDrafts.id, draft.id));
      failed++;
      if (errorSamples.length < 3) {
        errorSamples.push(`${draft.channel}: ${result.error}`);
      }
    }
  }

  // Count what's still failed after this pass so the UI can show "N remaining."
  const remainingRows = await db
    .select({ id: socialDrafts.id })
    .from(socialDrafts)
    .where(whereClause);

  return NextResponse.json({
    attempted: batch.length,
    succeeded,
    failed,
    remaining: remainingRows.length,
    samples: errorSamples,
  });
}
