// POST /api/admin/draft
// Body: { imageBase64: string, imageMediaType: string, notes: string }
// Returns: { title, slug, excerpt, body } — all strings, all editable on the
// client.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getClaude, DRAFT_MODEL, DRAFT_SYSTEM_PROMPT } from "@/lib/claude";
import { fetchUrlAsText } from "@/lib/url-fetch";
import type Anthropic from "@anthropic-ai/sdk";

// Use the Node runtime — the Anthropic SDK's streaming and large body
// handling work better than at the edge for this use case.
export const runtime = "nodejs";
export const maxDuration = 60;

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

type DraftRequest = {
  // Hero (the haul) — always required. Will be saved with the post.
  imageBase64: string;
  imageMediaType: ImageMediaType;
  // Context photo (where it came from) — optional. Only used as Claude
  // vision input; not saved with the post.
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

  const { imageBase64, imageMediaType, contextImageBase64, contextImageMediaType } = payload;
  // Accept either the new two-field shape or the legacy single `notes`
  const acquisitionContext = (
    payload.acquisitionContext ?? payload.notes ?? ""
  ).trim();
  const photoNotes = (payload.photoNotes ?? "").trim();
  const contextUrl = (payload.contextUrl ?? "").trim();

  if (!imageBase64 || !imageMediaType) {
    return NextResponse.json(
      { error: "imageBase64 and imageMediaType are required" },
      { status: 400 }
    );
  }
  // Some kind of text input or context image is required so Claude has
  // *something* beyond just the hero to work with.
  if (
    acquisitionContext.length + photoNotes.length < 10 &&
    !contextImageBase64 &&
    !contextUrl
  ) {
    return NextResponse.json(
      {
        error:
          "Tell us at least a sentence about where the haul came from, what's in the photo, or paste a source URL.",
      },
      { status: 400 }
    );
  }

  // Optionally fetch the source URL and pass its text to Claude.
  let urlText: string | null = null;
  if (contextUrl) {
    urlText = await fetchUrlAsText(contextUrl);
  }

  const claude = getClaude();

  const userMessage = `Acquisition context (where the haul came from):
${acquisitionContext.length ? acquisitionContext : "(not provided)"}

What's in the hero photo (visible items):
${photoNotes.length ? photoNotes : "(not provided — describe what you see in the image)"}

${contextImageBase64 ? "Context photo provided (separate from the hero — see second image)." : ""}
${
  contextUrl
    ? urlText
      ? `Source page (${contextUrl}) text excerpt:\n${urlText}`
      : `Source URL provided (${contextUrl}) but couldn't be fetched. Ignore.`
    : ""
}

Generate the draft journal post as JSON.`.replace(/\n{3,}/g, "\n\n");

  // Build the message content array. Hero photo always present; context
  // photo if provided.
  const content: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: imageMediaType,
        data: imageBase64,
      },
    },
  ];
  if (contextImageBase64 && contextImageMediaType) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: contextImageMediaType,
        data: contextImageBase64,
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
