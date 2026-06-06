// POST /api/admin/publish
// Commits the hero photo + any additional haul photos + the markdown
// post to the GitHub repo as one atomic commit. Vercel auto-rebuilds.
//
// The first image in haulImages becomes {slug}-hero.{ext}; subsequent
// images are saved as {slug}-1.{ext}, {slug}-2.{ext}, etc. and listed
// in the post's frontmatter `gallery` array.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { commitFiles, pathExists } from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 60;

type ImageMediaType =
  | "image/jpeg"
  | "image/jpg"
  | "image/png"
  | "image/webp"
  | "image/gif";

interface HaulImage {
  base64: string;
  mediaType: ImageMediaType;
}

interface PublishRequest {
  slug: string;
  title: string;
  date?: string; // ISO yyyy-mm-dd; defaults to today
  excerpt?: string;
  body: string;
  featured?: boolean;
  // Preferred: ordered array. First is the hero, rest go into the gallery.
  haulImages?: HaulImage[];
  // Legacy single-image shape — still accepted, equivalent to one-item haulImages.
  imageBase64?: string;
  imageMediaType?: ImageMediaType;
}

const EXT_FOR_MEDIA: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildFrontmatter(fields: {
  title: string;
  date: string;
  hero: string;
  gallery: string[];
  excerpt: string;
  featured: boolean;
}): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const galleryYaml = fields.gallery.length
    ? `gallery:\n${fields.gallery.map((g) => `  - "${g}"`).join("\n")}\n`
    : "";
  return `---
title: "${esc(fields.title)}"
date: "${fields.date}"
type: "haul"
hero: "${fields.hero}"
${galleryYaml}excerpt: "${esc(fields.excerpt)}"
featured: ${fields.featured ? "true" : "false"}
items: []
---
`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PublishRequest;
  try {
    body = (await req.json()) as PublishRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Normalize: prefer haulImages, fall back to legacy single-image
  let images: HaulImage[] = [];
  if (Array.isArray(body.haulImages) && body.haulImages.length > 0) {
    images = body.haulImages;
  } else if (body.imageBase64 && body.imageMediaType) {
    images = [
      { base64: body.imageBase64, mediaType: body.imageMediaType },
    ];
  }

  if (!body.slug || !body.title || !body.body || images.length === 0) {
    return NextResponse.json(
      {
        error:
          "slug, title, body, and at least one hero image are required",
      },
      { status: 400 }
    );
  }

  // Validate media types and build extension list
  const exts: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const ext = EXT_FOR_MEDIA[images[i].mediaType];
    if (!ext) {
      return NextResponse.json(
        {
          error: `Image ${i + 1} has unsupported media type "${images[i].mediaType}".`,
        },
        { status: 400 }
      );
    }
    exts.push(ext);
  }

  const slug = sanitizeSlug(body.slug);
  if (!slug) {
    return NextResponse.json(
      { error: "Slug is empty after sanitization" },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;

  // Build the list of paths we'll write
  const markdownPath = `content/posts/${slug}.md`;
  const heroPath = `public/photos/posts/${slug}-hero.${exts[0]}`;
  const heroUrl = `/photos/posts/${slug}-hero.${exts[0]}`;
  const galleryPaths: string[] = [];
  const galleryUrls: string[] = [];
  for (let i = 1; i < images.length; i++) {
    galleryPaths.push(`public/photos/posts/${slug}-${i}.${exts[i]}`);
    galleryUrls.push(`/photos/posts/${slug}-${i}.${exts[i]}`);
  }

  // Block if the markdown or hero already exists. We don't check gallery
  // paths because we'd never collide with our own slug pattern.
  try {
    const [mdExists, photoExists] = await Promise.all([
      pathExists(markdownPath),
      pathExists(heroPath),
    ]);
    if (mdExists || photoExists) {
      const which = [
        mdExists ? markdownPath : null,
        photoExists ? heroPath : null,
      ]
        .filter(Boolean)
        .join(" and ");
      return NextResponse.json(
        {
          error: `${which} already exist${mdExists && photoExists ? "" : "s"} in the repo. Pick a different slug.`,
        },
        { status: 409 }
      );
    }
  } catch (err) {
    console.error("[/api/admin/publish] pathExists check failed", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Could not check repo state: ${err.message}`
            : "Could not check repo state",
      },
      { status: 502 }
    );
  }

  const frontmatter = buildFrontmatter({
    title: body.title,
    date,
    hero: heroUrl,
    gallery: galleryUrls,
    excerpt: body.excerpt ?? "",
    featured: body.featured ?? true,
  });
  const markdown = `${frontmatter}\n${body.body.trim()}\n`;

  const filesToCommit = [
    { path: markdownPath, content: markdown, isBase64: false },
    { path: heroPath, content: images[0].base64, isBase64: true },
    ...galleryPaths.map((p, i) => ({
      path: p,
      content: images[i + 1].base64,
      isBase64: true,
    })),
  ];

  try {
    const result = await commitFiles(
      filesToCommit,
      `Add journal post: ${slug}${images.length > 1 ? ` (+${images.length - 1} gallery photos)` : ""}`
    );
    return NextResponse.json({
      ok: true,
      slug,
      postUrl: `/journal/${slug}`,
      commitSha: result.commitSha,
      commitUrl: result.commitUrl,
      photoCount: images.length,
    });
  } catch (err) {
    console.error("[/api/admin/publish] commit failed", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Commit failed",
      },
      { status: 502 }
    );
  }
}
