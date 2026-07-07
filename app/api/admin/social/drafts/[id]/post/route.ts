// POST /api/admin/social/drafts/[id]/post
//
// Posts a saved draft to its target channel right now (bypasses the
// schedule). Updates the row with postId/postUrl on success or
// postError + status="failed" on failure.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, socialDrafts } from "@/db";
import { eq } from "drizzle-orm";
import { postDraft } from "@/lib/posting";
import type { ChannelKey } from "@/lib/social/channel-styles";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Load the draft
  const [draft] = await db
    .select()
    .from(socialDrafts)
    .where(eq(socialDrafts.id, id));
  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  if (draft.status === "posted") {
    return NextResponse.json(
      { error: "Draft is already posted." },
      { status: 409 }
    );
  }

  // Attempt the post
  const result = await postDraft({
    channel: draft.channel as ChannelKey,
    content: draft.content as Record<string, unknown>,
    sourceImage: draft.sourceImage,
    sourceTitle: draft.sourceTitle,
    sourceUrl: draft.sourceUrl ?? null,
    contentType: draft.contentType,
  });

  // Persist the outcome
  type DraftPatch = Partial<typeof socialDrafts.$inferInsert>;
  const baseFields: DraftPatch = {
    attemptCount: (draft.attemptCount ?? 0) + 1,
    lastAttemptAt: new Date(),
    updatedAt: new Date(),
  };

  if (result.ok) {
    const [updated] = await db
      .update(socialDrafts)
      .set({
        ...baseFields,
        status: "posted",
        postedAt: new Date(),
        postId: result.postId,
        postUrl: result.postUrl,
        postError: null,
      })
      .where(eq(socialDrafts.id, id))
      .returning();
    return NextResponse.json({ ok: true, draft: updated });
  }

  const [updated] = await db
    .update(socialDrafts)
    .set({
      ...baseFields,
      status: "failed",
      postError: result.error,
    })
    .where(eq(socialDrafts.id, id))
    .returning();
  return NextResponse.json(
    { ok: false, error: result.error, draft: updated },
    { status: 502 }
  );
}
