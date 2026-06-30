// GET    /api/admin/haul-drafts/[id] — full draft (incl. photos)
// PATCH  /api/admin/haul-drafts/[id] — update any subset of fields
// DELETE /api/admin/haul-drafts/[id] — drop the draft

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, haulDrafts, type HaulDraftImage } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DraftWritePayload = {
  label?: string;
  heroImages?: HaulDraftImage[];
  contextImages?: HaulDraftImage[];
  acquisitionContext?: string;
  photoNotes?: string;
  contextUrl?: string;
  city?: string;
  state?: string;
  vagueLocation?: string;
  title?: string | null;
  slug?: string | null;
  excerpt?: string | null;
  body?: string | null;
};

function sanitizeImages(input: unknown): HaulDraftImage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((x): x is HaulDraftImage => {
      if (!x || typeof x !== "object") return false;
      const o = x as Record<string, unknown>;
      return (
        typeof o.base64 === "string" &&
        typeof o.mediaType === "string" &&
        typeof o.fileName === "string"
      );
    })
    .map((x) => ({
      base64: x.base64,
      mediaType: x.mediaType,
      fileName: x.fileName,
    }));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [row] = await db
      .select()
      .from(haulDrafts)
      .where(eq(haulDrafts.id, params.id))
      .limit(1);
    if (!row) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    return NextResponse.json({ draft: row });
  } catch (err) {
    console.error("[/api/admin/haul-drafts/:id GET] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Read failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: DraftWritePayload;
  try {
    payload = (await req.json()) as DraftWritePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Build a partial update — only include keys the client actually sent.
  // (Distinguish missing vs explicit null for nullable narrative columns.)
  const updates: Record<string, unknown> = {};

  if (typeof payload.label === "string") {
    updates.label = payload.label.slice(0, 200);
  }
  if (payload.heroImages !== undefined) {
    updates.heroImages = sanitizeImages(payload.heroImages);
  }
  if (payload.contextImages !== undefined) {
    updates.contextImages = sanitizeImages(payload.contextImages);
  }
  if (typeof payload.acquisitionContext === "string") {
    updates.acquisitionContext = payload.acquisitionContext;
  }
  if (typeof payload.photoNotes === "string") {
    updates.photoNotes = payload.photoNotes;
  }
  if (typeof payload.contextUrl === "string") {
    updates.contextUrl = payload.contextUrl;
  }
  if (typeof payload.city === "string") {
    updates.city = payload.city;
  }
  if (typeof payload.state === "string") {
    updates.state = payload.state;
  }
  if (typeof payload.vagueLocation === "string") {
    updates.vagueLocation = payload.vagueLocation;
  }
  if (payload.title !== undefined) updates.title = payload.title;
  if (payload.slug !== undefined) updates.slug = payload.slug;
  if (payload.excerpt !== undefined) updates.excerpt = payload.excerpt;
  if (payload.body !== undefined) updates.body = payload.body;

  // Always bump updatedAt so the list sorts correctly.
  updates.updatedAt = new Date();

  try {
    const [row] = await db
      .update(haulDrafts)
      .set(updates)
      .where(eq(haulDrafts.id, params.id))
      .returning();
    if (!row) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    return NextResponse.json({ id: row.id });
  } catch (err) {
    console.error("[/api/admin/haul-drafts/:id PATCH] failed", err);
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

  try {
    const result = await db
      .delete(haulDrafts)
      .where(eq(haulDrafts.id, params.id))
      .returning({ id: haulDrafts.id });
    if (result.length === 0) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/haul-drafts/:id DELETE] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
