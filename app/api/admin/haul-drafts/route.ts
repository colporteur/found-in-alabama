// POST /api/admin/haul-drafts — create a new saved draft
// GET  /api/admin/haul-drafts — list all saved drafts (summaries; no photos)
//
// Drafts let Todd capture inputs (photos + acquisition story + location) for
// a haul as soon as he gets home from a sale, and come back days later to
// refine, generate, and publish. See db/schema.ts haulDrafts for the shape.

import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
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

function sanitizePayload(p: DraftWritePayload) {
  return {
    label: typeof p.label === "string" ? p.label.slice(0, 200) : "",
    heroImages: sanitizeImages(p.heroImages),
    contextImages: sanitizeImages(p.contextImages),
    acquisitionContext:
      typeof p.acquisitionContext === "string" ? p.acquisitionContext : "",
    photoNotes: typeof p.photoNotes === "string" ? p.photoNotes : "",
    contextUrl: typeof p.contextUrl === "string" ? p.contextUrl : "",
    city: typeof p.city === "string" ? p.city : "",
    state: typeof p.state === "string" ? p.state : "Alabama",
    vagueLocation: typeof p.vagueLocation === "string" ? p.vagueLocation : "",
    title:
      typeof p.title === "string"
        ? p.title
        : p.title === null
          ? null
          : undefined,
    slug:
      typeof p.slug === "string" ? p.slug : p.slug === null ? null : undefined,
    excerpt:
      typeof p.excerpt === "string"
        ? p.excerpt
        : p.excerpt === null
          ? null
          : undefined,
    body:
      typeof p.body === "string" ? p.body : p.body === null ? null : undefined,
  };
}

export async function POST(req: NextRequest) {
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

  const clean = sanitizePayload(payload);

  // Strip undefineds so Drizzle uses defaults for nullable narrative fields.
  const insertRow = {
    label: clean.label,
    heroImages: clean.heroImages,
    contextImages: clean.contextImages,
    acquisitionContext: clean.acquisitionContext,
    photoNotes: clean.photoNotes,
    contextUrl: clean.contextUrl,
    city: clean.city,
    state: clean.state,
    vagueLocation: clean.vagueLocation,
    ...(clean.title !== undefined ? { title: clean.title } : {}),
    ...(clean.slug !== undefined ? { slug: clean.slug } : {}),
    ...(clean.excerpt !== undefined ? { excerpt: clean.excerpt } : {}),
    ...(clean.body !== undefined ? { body: clean.body } : {}),
  };

  try {
    const [row] = await db.insert(haulDrafts).values(insertRow).returning();
    return NextResponse.json({ id: row.id });
  } catch (err) {
    console.error("[/api/admin/haul-drafts POST] insert failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Insert failed" },
      { status: 500 }
    );
  }
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Pull all fields including photos so we can surface the hero thumbnail.
    // Drafts are infrequent and bounded, so loading the JSONB isn't a worry
    // at this scale.
    const rows = await db
      .select()
      .from(haulDrafts)
      .orderBy(desc(haulDrafts.updatedAt))
      .limit(200);

    // Project to a summary shape: include just the first hero or first
    // context photo as a preview, drop the rest of the base64 to keep the
    // list response small.
    const summaries = rows.map((r) => {
      const firstPhoto =
        r.heroImages[0] ?? r.contextImages[0] ?? null;
      return {
        id: r.id,
        label: r.label,
        heroCount: r.heroImages.length,
        contextCount: r.contextImages.length,
        hasNarrative: !!(r.title || r.body),
        title: r.title,
        previewPhoto: firstPhoto
          ? {
              base64: firstPhoto.base64,
              mediaType: firstPhoto.mediaType,
            }
          : null,
        acquisitionContext: r.acquisitionContext,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });

    return NextResponse.json({ drafts: summaries });
  } catch (err) {
    console.error("[/api/admin/haul-drafts GET] list failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "List failed" },
      { status: 500 }
    );
  }
}
