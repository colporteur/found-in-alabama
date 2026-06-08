// POST /api/admin/social/generate
//
// Body: { sourceType: "haul" | "item", sourceId: string,
//         channels: ChannelKey[], contentType: SocialContentType }
//
// Returns: { drafts: { [channelKey]: <channel-shaped object> }, usage }
//
// One Claude vision call → all requested channels at once as a single
// JSON object. Cheaper than per-channel calls and keeps voice consistent.

import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, items } from "@/db";
import { eq } from "drizzle-orm";
import { getClaude } from "@/lib/claude";
import { getPost } from "@/lib/posts";
import {
  CHANNELS,
  type ChannelKey,
} from "@/lib/social/channel-styles";
import {
  buildSystemPrompt,
  buildUserMessage,
  type SocialContentType,
  type SocialSource,
} from "@/lib/social/prompts";
import {
  getVoiceSamples,
  formatVoiceSamplesPrompt,
} from "@/lib/social/voice-samples";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

type UserContentBlock =
  | {
      type: "image";
      source: { type: "base64"; media_type: ImageMediaType; data: string };
    }
  | { type: "text"; text: string };

type GenerateRequest = {
  sourceType: "haul" | "item";
  sourceId: string; // slug for haul, uuid for item
  channels: ChannelKey[];
  contentType: SocialContentType;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mediaTypeFromExt(ext: string): ImageMediaType {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  return "image/jpeg";
}

/**
 * Resolve a hero image to { base64, mediaType }. Handles:
 *  - Local /photos/... paths → read from public/
 *  - Full http(s) URLs → fetch
 * Returns null if the image can't be loaded — we just skip vision in that case.
 */
async function loadImage(
  src: string | null | undefined
): Promise<{ base64: string; mediaType: ImageMediaType } | null> {
  if (!src) return null;
  try {
    if (src.startsWith("http://") || src.startsWith("https://")) {
      const res = await fetch(src, {
        // Don't hang the route on a slow CDN
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      const buf = Buffer.from(await res.arrayBuffer());
      let mt: ImageMediaType = "image/jpeg";
      if (ct.includes("png")) mt = "image/png";
      else if (ct.includes("webp")) mt = "image/webp";
      else if (ct.includes("gif")) mt = "image/gif";
      else {
        // Fall back to extension if Content-Type is missing/weird
        const ext = src.split("?")[0].split(".").pop() ?? "";
        mt = mediaTypeFromExt(ext);
      }
      return { base64: buf.toString("base64"), mediaType: mt };
    }
    // Local path under public/
    const rel = src.startsWith("/") ? src.slice(1) : src;
    const absolute = path.join(process.cwd(), "public", rel);
    const buf = await fs.readFile(absolute);
    const ext = absolute.split(".").pop() ?? "";
    return { base64: buf.toString("base64"), mediaType: mediaTypeFromExt(ext) };
  } catch {
    return null;
  }
}

async function loadHaulSource(slug: string): Promise<SocialSource | null> {
  const post = getPost(slug);
  if (!post) return null;

  // Plain-text body from the rendered HTML
  const plainBody = (post.contentHtml ?? "")
    .replace(/<\/(p|h\d|li|br)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Count items linked to this haul so the prompt can mention "from 24 items"
  let itemCount: number | undefined;
  try {
    const rows = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.haulPostSlug, slug));
    itemCount = rows.length;
  } catch {
    // DB might not be reachable in dev — don't fail the whole generation
  }

  return {
    kind: "haul",
    title: post.title,
    slug: post.slug,
    date: post.date,
    excerpt: post.excerpt ?? "",
    body: plainBody,
    heroImage: post.hero ?? null,
    itemCount,
  };
}

async function loadItemSource(id: string): Promise<SocialSource | null> {
  const [row] = await db.select().from(items).where(eq(items.id, id));
  if (!row) return null;

  // If the item is linked to a haul, include the haul's title/excerpt
  let haulTitle: string | undefined;
  let haulSlug: string | undefined;
  let haulExcerpt: string | undefined;
  if (row.haulPostSlug) {
    const haul = getPost(row.haulPostSlug);
    if (haul) {
      haulTitle = haul.title;
      haulSlug = haul.slug;
      haulExcerpt = haul.excerpt;
    }
  }

  return {
    kind: "item",
    title: row.title,
    heroImage: row.heroImage,
    price: row.price,
    marketplaceUrls: (row.marketplaceUrls as Record<string, string>) ?? {},
    haulTitle,
    haulSlug,
    haulExcerpt,
  };
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate channels
  const validChannelKeys = new Set(Object.keys(CHANNELS) as ChannelKey[]);
  const requested = Array.isArray(body.channels)
    ? body.channels.filter((c): c is ChannelKey => validChannelKeys.has(c))
    : [];
  if (requested.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one channel." },
      { status: 400 }
    );
  }

  const validContentTypes = new Set<SocialContentType>([
    "just-listed",
    "new-haul",
    "throwback",
    "just-sold",
  ]);
  if (!validContentTypes.has(body.contentType)) {
    return NextResponse.json(
      { error: `Unknown contentType "${body.contentType}".` },
      { status: 400 }
    );
  }

  if (!body.sourceId) {
    return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
  }

  // Resolve the source
  let source: SocialSource | null;
  if (body.sourceType === "haul") {
    source = await loadHaulSource(body.sourceId);
  } else if (body.sourceType === "item") {
    source = await loadItemSource(body.sourceId);
  } else {
    return NextResponse.json(
      { error: `Unknown sourceType "${body.sourceType}".` },
      { status: 400 }
    );
  }
  if (!source) {
    return NextResponse.json(
      { error: `${body.sourceType} not found: ${body.sourceId}` },
      { status: 404 }
    );
  }

  // Voice samples from recent journal posts
  const voiceSamples = getVoiceSamples();
  const voiceBlock = formatVoiceSamplesPrompt(voiceSamples);

  // Build the user message and content array (with optional image)
  const userText = buildUserMessage({
    source,
    contentType: body.contentType,
    channels: requested,
    voiceSamplesBlock: voiceBlock,
  });

  const content: UserContentBlock[] = [];
  const image = await loadImage(source.heroImage);
  if (image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.base64,
      },
    });
  }
  content.push({ type: "text", text: userText });

  // Call Claude
  const claude = getClaude();
  try {
    const response = await claude.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "Claude returned no text content" },
        { status: 502 }
      );
    }

    // Parse JSON, leniently
    const raw = textBlock.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let drafts: Record<string, unknown>;
    try {
      drafts = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        {
          error: "Claude returned non-JSON output",
          raw: raw.slice(0, 500),
        },
        { status: 502 }
      );
    }

    // Filter to requested keys only (defensive — Claude shouldn't add extras)
    const filtered: Record<string, unknown> = {};
    for (const key of requested) {
      if (key in drafts) filtered[key] = drafts[key];
    }

    // generationId groups all channels from this one call. Returned to
    // the client so a follow-up POST /api/admin/social/drafts can save
    // the lot with a shared group id.
    const generationId = randomUUID();

    // Denormalized source fields the client needs to save drafts
    const sourcePayload =
      source.kind === "haul"
        ? {
            sourceType: "haul" as const,
            sourceId: source.slug,
            sourceTitle: source.title,
            sourceImage: source.heroImage,
          }
        : {
            sourceType: "item" as const,
            sourceId: body.sourceId,
            sourceTitle: source.title,
            sourceImage: source.heroImage,
          };

    return NextResponse.json({
      drafts: filtered,
      missingChannels: requested.filter((k) => !(k in filtered)),
      usedVision: !!image,
      generationId,
      contentType: body.contentType,
      source: sourcePayload,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    console.error("[/api/admin/social/generate] Claude call failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Claude call failed" },
      { status: 500 }
    );
  }
}
