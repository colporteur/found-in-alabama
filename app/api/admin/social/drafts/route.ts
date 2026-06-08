// /api/admin/social/drafts
// POST — save one or many generated drafts to the social_drafts table.
// GET  — list drafts with optional status filter and pagination.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, socialDrafts } from "@/db";
import { desc, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";

type SaveDraftInput = {
  sourceType: "haul" | "item";
  sourceId: string;
  sourceTitle: string;
  sourceImage?: string | null;
  generationId: string;
  contentType: "just-listed" | "new-haul" | "throwback" | "just-sold";
  channel: string;
  content: Record<string, unknown>;
};

type SaveDraftsBody = { drafts: SaveDraftInput[] };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: SaveDraftsBody;
  try {
    body = (await req.json()) as SaveDraftsBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.drafts) || body.drafts.length === 0) {
    return NextResponse.json(
      { error: "drafts[] required" },
      { status: 400 }
    );
  }
  try {
    const rows = await db
      .insert(socialDrafts)
      .values(
        body.drafts.map((d) => ({
          sourceType: d.sourceType,
          sourceId: d.sourceId,
          sourceTitle: d.sourceTitle,
          sourceImage: d.sourceImage ?? null,
          generationId: d.generationId,
          contentType: d.contentType,
          channel: d.channel,
          content: d.content,
        }))
      )
      .returning({ id: socialDrafts.id, channel: socialDrafts.channel });
    return NextResponse.json({ saved: rows });
  } catch (err) {
    console.error("[/api/admin/social/drafts POST] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status"); // comma-separated list optional
  const allowedStatuses = ["draft", "scheduled", "posted", "skipped"] as const;
  const statuses = statusParam
    ? statusParam
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is (typeof allowedStatuses)[number] =>
          (allowedStatuses as readonly string[]).includes(s)
        )
    : null;

  try {
    const rows = await db
      .select()
      .from(socialDrafts)
      .where(statuses && statuses.length > 0 ? inArray(socialDrafts.status, statuses) : undefined)
      .orderBy(desc(socialDrafts.createdAt))
      .limit(500);
    return NextResponse.json({ drafts: rows });
  } catch (err) {
    console.error("[/api/admin/social/drafts GET] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "List failed" },
      { status: 500 }
    );
  }
}
