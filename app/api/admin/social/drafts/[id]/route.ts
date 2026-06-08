// /api/admin/social/drafts/[id]
// PATCH  — update content, schedule, status, or notes on one draft.
// DELETE — remove the draft.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, socialDrafts } from "@/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

const ALLOWED_STATUSES = ["draft", "scheduled", "posted", "skipped"] as const;
type DraftStatus = (typeof ALLOWED_STATUSES)[number];

type PatchBody = {
  content?: Record<string, unknown>;
  status?: DraftStatus;
  /** ISO timestamp or null to clear */
  scheduledFor?: string | null;
  /** ISO timestamp or null. Defaults to now if status flips to "posted". */
  postedAt?: string | null;
  notes?: string | null;
};

export async function PATCH(
  req: NextRequest,
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
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Build the partial update. Typed as Partial of socialDrafts' insert
  // shape so Drizzle's .set() accepts it.
  type DraftPatch = Partial<typeof socialDrafts.$inferInsert>;
  const patch: DraftPatch = { updatedAt: new Date() };
  if (body.content !== undefined) patch.content = body.content;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.scheduledFor !== undefined) {
    patch.scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
  }
  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `Unknown status "${body.status}"` },
        { status: 400 }
      );
    }
    patch.status = body.status;
    // Helpful default: when flipping to "posted" without an explicit
    // postedAt, stamp it now.
    if (body.status === "posted" && body.postedAt === undefined) {
      patch.postedAt = new Date();
    }
  }
  if (body.postedAt !== undefined) {
    patch.postedAt = body.postedAt ? new Date(body.postedAt) : null;
  }

  // We always seed `updatedAt`; if nothing else was set, that's a no-op
  // request.
  const meaningfulKeys = Object.keys(patch).filter((k) => k !== "updatedAt");
  if (meaningfulKeys.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const [row] = await db
      .update(socialDrafts)
      .set(patch)
      .where(eq(socialDrafts.id, id))
      .returning();
    if (!row) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    return NextResponse.json({ draft: row });
  } catch (err) {
    console.error(`[/api/admin/social/drafts/${id} PATCH] failed`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
  try {
    const [row] = await db
      .delete(socialDrafts)
      .where(eq(socialDrafts.id, id))
      .returning({ id: socialDrafts.id });
    if (!row) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[/api/admin/social/drafts/${id} DELETE] failed`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
