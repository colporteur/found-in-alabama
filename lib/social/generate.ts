// Core social draft generation — one Claude vision call returns content
// for all requested channels at once.
//
// Extracted from app/api/admin/social/generate/route.ts (Phase B) so the
// same generation can run from the admin UI route AND the automation
// cron. The route keeps auth + request validation; this module does the
// actual work.

import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { db, items } from "@/db";
import { eq } from "drizzle-orm";
import { getClaude } from "@/lib/claude";
import { getPost, displayLocation } from "@/lib/posts";
import type { ChannelKey } from "@/lib/social/channel-styles";
import {
  buildSystemPrompt,
  buildUserMessage,
  sourceUrl as computeSourceUrl,
  type SocialContentType,
  type SocialSource,
} from "@/lib/social/prompts";
import {
  getVoiceSamples,
  formatVoiceSamplesPrompt,
} from "@/lib/social/voice-samples";

const MODEL = "claude-sonnet-5";

export type ImageMediaType =
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
 * Returns null if the image can't be loaded — we just skip vision then.
 */
export async function loadImage(
  src: string | null | undefined
): Promise<{ base64: string; mediaType: ImageMediaType } | null> {
  if (!src) return null;
  try {
    if (src.startsWith("http://") || src.startsWith("https://")) {
      const res = await fetch(src, {
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
        const ext = src.split("?")[0].split(".").pop() ?? "";
        mt = mediaTypeFromExt(ext);
      }
      return { base64: buf.toString("base64"), mediaType: mt };
    }
    const rel = src.startsWith("/") ? src.slice(1) : src;
    const absolute = path.join(process.cwd(), "public", rel);
    const buf = await fs.readFile(absolute);
    const ext = absolute.split(".").pop() ?? "";
    return { base64: buf.toString("base64"), mediaType: mediaTypeFromExt(ext) };
  } catch {
    return null;
  }
}

export async function loadHaulSource(
  slug: string
): Promise<SocialSource | null> {
  const post = getPost(slug);
  if (!post) return null;

  const plainBody = (post.contentHtml ?? "")
    .replace(/<\/(p|h\d|li|br)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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
    location: displayLocation(post),
  };
}

export async function loadItemSource(
  id: string
): Promise<SocialSource | null> {
  const [row] = await db.select().from(items).where(eq(items.id, id));
  if (!row) return null;

  let haulTitle: string | undefined;
  let haulSlug: string | undefined;
  let haulExcerpt: string | undefined;
  let location: string | null = null;
  if (row.haulPostSlug) {
    const haul = getPost(row.haulPostSlug);
    if (haul) {
      haulTitle = haul.title;
      haulSlug = haul.slug;
      haulExcerpt = haul.excerpt;
      location = displayLocation(haul);
    }
  }

  return {
    kind: "item",
    title: row.title,
    slug: row.slug ?? null,
    heroImage: row.heroImage,
    price: row.price,
    marketplaceUrls: (row.marketplaceUrls as Record<string, string>) ?? {},
    haulTitle,
    haulSlug,
    haulExcerpt,
    location,
  };
}

export type GenerationResult = {
  /** Per-channel content keyed by ChannelKey — only requested channels. */
  drafts: Record<string, unknown>;
  missingChannels: ChannelKey[];
  usedVision: boolean;
  generationId: string;
  source: {
    sourceType: "haul" | "item";
    sourceId: string;
    sourceTitle: string;
    sourceImage: string | null;
    sourceUrl: string | null;
  };
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * Run one generation: load the source, call Claude with vision, parse
 * the per-channel JSON. Throws Error with a readable message on failure.
 */
export async function generateChannelDrafts(input: {
  sourceType: "haul" | "item";
  sourceId: string;
  channels: ChannelKey[];
  contentType: SocialContentType;
}): Promise<GenerationResult> {
  const source =
    input.sourceType === "haul"
      ? await loadHaulSource(input.sourceId)
      : await loadItemSource(input.sourceId);
  if (!source) {
    throw new Error(`${input.sourceType} not found: ${input.sourceId}`);
  }

  const voiceSamples = getVoiceSamples();
  const voiceBlock = formatVoiceSamplesPrompt(voiceSamples);

  const userText = buildUserMessage({
    source,
    contentType: input.contentType,
    channels: input.channels,
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

  const claude = getClaude();
  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 3500, // Sonnet 5: +30% tokenizer + adaptive thinking budget
    system: buildSystemPrompt(),
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  const raw = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let drafts: Record<string, unknown>;
  try {
    drafts = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Claude returned non-JSON output: ${raw.slice(0, 300)}`
    );
  }

  const filtered: Record<string, unknown> = {};
  for (const key of input.channels) {
    if (key in drafts) filtered[key] = drafts[key];
  }

  const computedUrl = computeSourceUrl(source);
  return {
    drafts: filtered,
    missingChannels: input.channels.filter((k) => !(k in filtered)),
    usedVision: !!image,
    generationId: randomUUID(),
    source: {
      sourceType: input.sourceType,
      sourceId: source.kind === "haul" ? source.slug : input.sourceId,
      sourceTitle: source.title,
      sourceImage: source.heroImage ?? null,
      sourceUrl: computedUrl,
    },
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
