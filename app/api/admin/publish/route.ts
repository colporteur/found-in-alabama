// POST /api/admin/publish
// Commits the hero photo + the markdown post to the GitHub repo as one
// atomic commit. Vercel auto-rebuilds.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { commitFiles, pathExists } from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PublishRequest {
  slug: string;
  title: string;
  date?: string; // ISO yyyy-mm-dd; defaults to today
  excerpt?: string;
  body: string;
  featured?: boolean;
  imageBase64: string;
  imageMediaType: string; // "image/jpeg" | "image/png" | "image/webp" | "image/gif"
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
  excerpt: string;
  featured: boolean;
}): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  return `---
title: "${esc(fields.title)}"
date: "${fields.date}"
type: "haul"
hero: "${fields.hero}"
excerpt: "${esc(fields.excerpt)}"
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

  // Validate
  if (!body.slug || !body.title || !body.body || !body.imageBase64 || !body.imageMediaType) {
    return NextResponse.json(
      { error: "slug, title, body, imageBase64, and imageMediaType are required" },
      { status: 400 }
    );
  }
  const ext = EXT_FOR_MEDIA[body.imageMediaType];
  if (!ext) {
    return NextResponse.json(
      { error: `Image media type "${body.imageMediaType}" not supported.` },
      { status: 400 }
    );
  }

  const slug = sanitizeSlug(body.slug);
  if (!slug) {
    return NextResponse.json({ error: "Slug is empty after sanitization" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;

  const markdownPath = `content/posts/${slug}.md`;
  const photoPath = `public/photos/posts/${slug}-hero.${ext}`;
  const heroUrl = `/photos/posts/${slug}-hero.${ext}`;

  // Block if either path exists — safer than silently overwriting
  try {
    const [mdExists, photoExists] = await Promise.all([
      pathExists(markdownPath),
      pathExists(photoPath),
    ]);
    if (mdExists || photoExists) {
      const which = [
        mdExists ? markdownPath : null,
        photoExists ? photoPath : null,
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
    excerpt: body.excerpt ?? "",
    featured: body.featured ?? true,
  });
  const markdown = `${frontmatter}\n${body.body.trim()}\n`;

  try {
    const result = await commitFiles(
      [
        { path: markdownPath, content: markdown, isBase64: false },
        { path: photoPath, content: body.imageBase64, isBase64: true },
      ],
      `Add journal post: ${slug}`
    );
    return NextResponse.json({
      ok: true,
      slug,
      postUrl: `/journal/${slug}`,
      commitSha: result.commitSha,
      commitUrl: result.commitUrl,
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
