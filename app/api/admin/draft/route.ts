// POST /api/admin/draft
// Body: {
//   heroImages: [{ base64, mediaType }],  // 1+ haul photos
//   contextImages?: [{ base64, mediaType }],  // 0+ context photos
//   acquisitionContext?, photoNotes?, contextUrl?, notes?
// }
// Returns: { title, slug, excerpt, body }
//
// Legacy single-image fields (imageBase64/imageMediaType/contextImageBase64/
// contextImageMediaType) are still accepted to keep older clients working.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getClaude, DRAFT_MODEL, DRAFT_SYSTEM_PROMPT } from "@/lib/claude";
import { fetchUrlAsText } from "@/lib/url-fetch";

// Use the Node runtime — the Anthropic SDK's streaming and large body
// handling work better than at the edge for this use case.
export const runtime = "nodejs";
export const maxDuration = 60;

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

// Structural type matching what the SDK's messages.create accepts for the
// `content` field on a user message. We avoid importing the SDK's named
// types because their exports shift between versions; the wire format is
// stable, so a literal type is more durable.
type UserContentBlock =
  | {
      type: "image";
      source: { type: "base64"; media_type: ImageMediaType; data: string };
    }
  | { type: "text"; text: string };

type ImagePayload = { base64: string; mediaType: ImageMediaType };

type DraftRequest = {
  // Preferred: arrays. heroImages[0] is the main photo Claude focuses on.
  heroImages?: ImagePayload[];
  contextImages?: ImagePayload[];
  // Legacy single-image fields — still accepted.
  imageBase64?: string;
  imageMediaType?: ImageMediaType;
  contextImageBase64?: string;
  contextImageMediaType?: ImageMediaType;
  /** Where the haul came from (estate, auction, etc.) — narrative spine. */
  acquisitionContext?: string;
  /** What's in the hero photo — grounds specific details. */
  photoNotes?: string;
  /** Public URL Claude should scrape for additional context. */
  contextUrl?: string;
  /** Legacy single-field; if provided, used as acquisitionContext. */
  notes?: string;
};

type DraftResponse = {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
};

// Hard caps so a misbehaving client can't fire 50 images at Claude.
const MAX_HERO_IMAGES = 8;
const MAX_CONTEXT_IMAGES = 5;

export async function POST(req: NextRequest) {
  // Auth gate — must be the signed-in admin.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: DraftRequest;
  try {
    payload = (await req.json()) as DraftRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Normalize to arrays. Prefer the new shape; fall back to legacy fields.
  let heroImages: ImagePayload[] = [];
  if (Array.isArray(payload.heroImages) && payload.heroImages.length > 0) {
    heroImages = payload.heroImages;
  } else if (payload.imageBase64 && payload.imageMediaType) {
    heroImages = [
      { base64: payload.imageBase64, mediaType: payload.imageMediaType },
    ];
  }

  let contextImages: ImagePayload[] = [];
  if (Array.isArray(payload.contextImages) && payload.contextImages.length > 0) {
    contextImages = payload.contextImages;
  } else if (payload.contextImageBase64 && payload.contextImageMediaType) {
    contextImages = [
      {
        base64: payload.contextImageBase64,
        mediaType: payload.contextImageMediaType,
      },
    ];
  }

  // At least one photo of either kind is required. Hero photos and
  // context photos carry equal narrative weight — the seller may upload
  // only haul photos, only context photos, or any mix.
  if (heroImages.length + contextImages.length === 0) {
    return NextResponse.json(
      { error: "At least one photo (haul or context) is required" },
      { status: 400 }
    );
  }
  if (heroImages.length > MAX_HERO_IMAGES) {
    return NextResponse.json(
      { error: `Too many haul images. Max is ${MAX_HERO_IMAGES}.` },
      { status: 400 }
    );
  }
  if (contextImages.length > MAX_CONTEXT_IMAGES) {
    return NextResponse.json(
      { error: `Too many context images. Max is ${MAX_CONTEXT_IMAGES}.` },
      { status: 400 }
    );
  }

  // Accept either the new two-field shape or the legacy single `notes`
  const acquisitionContext = (
    payload.acquisitionContext ?? payload.notes ?? ""
  ).trim();
  const photoNotes = (payload.photoNotes ?? "").trim();
  const contextUrl = (payload.contextUrl ?? "").trim();

  // Optionally fetch the source URL and pass its text to Claude.
  let urlText: string | null = null;
  if (contextUrl) {
    urlText = await fetchUrlAsText(contextUrl);
  }

  const claude = getClaude();

  // Describe what was uploaded. Hero and context photos are presented
  // as equally-weighted evidence — the seller chooses the mix.
  const photoSummary = (() => {
    const parts: string[] = [];
    if (heroImages.length > 0) {
      parts.push(
        heroImages.length === 1
          ? "1 haul photo (items the seller acquired)"
          : `${heroImages.length} haul photos (items the seller acquired)`
      );
    }
    if (contextImages.length > 0) {
      parts.push(
        contextImages.length === 1
          ? "1 context photo (the source — signage, the room, an auction page, etc.)"
          : `${contextImages.length} context photos (the source — signage, the room, an auction page, etc.)`
      );
    }
    return parts.join(" and ");
  })();

  const userMessage = `Acquisition story (where the haul came from):
${acquisitionContext.length ? acquisitionContext : "(not provided)"}

What's in the photos (visible items):
${photoNotes.length ? photoNotes : "(not provided)"}

Photos attached: ${photoSummary}. Treat all attached photos as equally-weighted visual evidence — describe what you can actually see, do not invent items, brands, names, dates, or stories beyond what is clearly visible or stated.
${
  contextUrl
    ? urlText
      ? `Source page (${contextUrl}) text excerpt:\n${urlText}`
      : `Source URL provided (${contextUrl}) but couldn't be fetched. Ignore.`
    : ""
}

Generate the draft journal post as JSON. Stick strictly to facts derivable from the inputs above. Shorter is fine if the inputs are sparse.`.replace(/\n{3,}/g, "\n\n");

  // Build the content array. Order:
  //   1. All hero photos (the haul), in user-supplied order
  //   2. All context photos
  //   3. The text prompt
  const content: UserContentBlock[] = [];
  for (const img of heroImages) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.base64,
      },
    });
  }
  for (const img of contextImages) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.base64,
      },
    });
  }
  content.push({ type: "text", text: userMessage });

  try {
    const response = await claude.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1500,
      system: DRAFT_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "Claude returned no text content" },
        { status: 502 }
      );
    }

    // Parse the JSON Claude returned. Be lenient: strip code fences and
    // trim whitespace before parsing.
    const raw = textBlock.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let draft: DraftResponse;
    try {
      draft = JSON.parse(raw) as DraftResponse;
    } catch {
      return NextResponse.json(
        {
          error: "Claude returned non-JSON output",
          raw: raw.slice(0, 500),
        },
        { status: 502 }
      );
    }

    if (!draft.title || !draft.body) {
      return NextResponse.json(
        { error: "Generated draft missing required fields" },
        { status: 502 }
      );
    }

    // Clean up slug — make sure it's kebab-case even if Claude got creative.
    if (draft.slug) {
      draft.slug = draft.slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    }

    return NextResponse.json({
      title: draft.title,
      slug: draft.slug,
      excerpt: draft.excerpt ?? "",
      body: draft.body,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    console.error("[/api/admin/draft] Claude call failed", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Claude call failed",
      },
      { status: 500 }
    );
  }
}
