// POST /api/admin/draft
// Body: { imageBase64: string, imageMediaType: string, notes: string }
// Returns: { title, slug, excerpt, body } — all strings, all editable on the
// client.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getClaude, DRAFT_MODEL, DRAFT_SYSTEM_PROMPT } from "@/lib/claude";

// Use the Node runtime — the Anthropic SDK's streaming and large body
// handling work better than at the edge for this use case.
export const runtime = "nodejs";
export const maxDuration = 60;

type DraftRequest = {
  imageBase64: string;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  /** Where the haul came from (estate, auction, etc.) — narrative spine. */
  acquisitionContext?: string;
  /** What's in the hero photo — grounds specific details. */
  photoNotes?: string;
  /** Legacy single-field; if provided, used as acquisitionContext. */
  notes?: string;
};

type DraftResponse = {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
};

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

  const { imageBase64, imageMediaType } = payload;
  // Accept either the new two-field shape or the legacy single `notes`
  const acquisitionContext = (
    payload.acquisitionContext ?? payload.notes ?? ""
  ).trim();
  const photoNotes = (payload.photoNotes ?? "").trim();

  if (!imageBase64 || !imageMediaType) {
    return NextResponse.json(
      { error: "imageBase64 and imageMediaType are required" },
      { status: 400 }
    );
  }
  // At least one of the two text inputs must be substantive
  if (acquisitionContext.length + photoNotes.length < 10) {
    return NextResponse.json(
      {
        error:
          "Tell us at least a sentence about where the haul came from or what's in the photo.",
      },
      { status: 400 }
    );
  }

  const claude = getClaude();

  const userMessage = `Acquisition context (where the haul came from):
${acquisitionContext.length ? acquisitionContext : "(not provided — infer from the photo)"}

What's in the hero photo (visible items):
${photoNotes.length ? photoNotes : "(not provided — describe what you see in the image)"}

Generate the draft journal post as JSON.`;

  try {
    const response = await claude.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1500,
      system: DRAFT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: imageMediaType,
                data: imageBase64,
              },
            },
            { type: "text", text: userMessage },
          ],
        },
      ],
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
