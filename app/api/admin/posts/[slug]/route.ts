// PATCH /api/admin/posts/[slug]
//
// Updates an existing haul post by re-committing its markdown file via
// GitHub Contents API. We preserve any frontmatter fields we don't
// touch (hero, gallery, items, etc.) by reading the existing file from
// disk and merging the patch in.
//
// Slug, hero, and gallery are NOT editable here — changing the slug
// would break existing URLs (social links, product page back-links).
// Image management is a separate phase.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { commitFiles } from "@/lib/github";
import { readRawPost } from "@/lib/posts-edit";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PatchBody {
  title?: string;
  date?: string;
  excerpt?: string;
  body?: string;
  featured?: boolean;
  city?: string | null;
  state?: string | null;
  vagueLocation?: string | null;
}

/** YAML-escape a string value. */
function esc(s: string): string {
  return s.replace(/"/g, '\\"');
}

/**
 * Render frontmatter from a merged object. We control the key order
 * here so that diffs stay readable: title → date → type → location →
 * media → excerpt → featured → items.
 */
function renderFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  const order = [
    "title",
    "date",
    "type",
    "city",
    "state",
    "vagueLocation",
    "hero",
    "gallery",
    "excerpt",
    "featured",
    "streamDate",
    "streamUrl",
    "dateStart",
    "dateEnd",
  ];
  // Render known keys in our preferred order
  for (const k of order) {
    if (!(k in fm)) continue;
    const v = fm[k];
    if (v === undefined || v === null || v === "") continue;
    if (k === "gallery" && Array.isArray(v)) {
      const list = v.filter((x) => typeof x === "string");
      if (list.length === 0) continue;
      lines.push("gallery:");
      for (const item of list) lines.push(`  - "${esc(String(item))}"`);
      continue;
    }
    if (typeof v === "boolean") {
      lines.push(`${k}: ${v ? "true" : "false"}`);
      continue;
    }
    lines.push(`${k}: "${esc(String(v))}"`);
  }
  // Items array — preserve whatever was there (we never edit it here).
  if (Array.isArray(fm.items)) {
    if ((fm.items as unknown[]).length === 0) {
      lines.push("items: []");
    } else {
      // Hand-written items in legacy posts. Re-serialize via JSON-ish YAML.
      lines.push("items:");
      for (const it of fm.items as Record<string, unknown>[]) {
        lines.push(`  - ${JSON.stringify(it)}`);
      }
    }
  }
  // Pass through any unknown frontmatter keys at the end so we never
  // accidentally drop something a future phase added.
  const known = new Set([...order, "items"]);
  for (const k of Object.keys(fm)) {
    if (known.has(k)) continue;
    const v = fm[k];
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!params.slug || !/^[a-z0-9-]+$/i.test(params.slug)) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  // Read existing post — this is the source of truth for unedited fields.
  const existing = readRawPost(params.slug);
  if (!existing) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  let patch: PatchBody;
  try {
    patch = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Merge: start from existing, apply only the fields the patch sent.
  // `null` is treated as "clear this field" so the user can wipe a
  // vagueLocation by saving the form with that field empty.
  const merged: Record<string, unknown> = { ...existing.frontmatter };
  if (patch.title !== undefined) merged.title = patch.title;
  if (patch.date !== undefined) merged.date = patch.date;
  if (patch.excerpt !== undefined) merged.excerpt = patch.excerpt;
  if (patch.featured !== undefined) merged.featured = patch.featured;
  if (patch.city !== undefined) {
    if (patch.city === null || patch.city === "") delete merged.city;
    else merged.city = patch.city;
  }
  if (patch.state !== undefined) {
    if (patch.state === null || patch.state === "") delete merged.state;
    else merged.state = patch.state;
  }
  if (patch.vagueLocation !== undefined) {
    if (patch.vagueLocation === null || patch.vagueLocation === "")
      delete merged.vagueLocation;
    else merged.vagueLocation = patch.vagueLocation;
  }

  // Validate the date if it changed
  if (
    merged.date &&
    typeof merged.date === "string" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(merged.date)
  ) {
    return NextResponse.json(
      { error: "date must be in YYYY-MM-DD format" },
      { status: 400 }
    );
  }
  if (!merged.title || typeof merged.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  // Build the markdown
  const frontmatterYaml = renderFrontmatter(merged);
  const newBody =
    typeof patch.body === "string" ? patch.body.trim() : existing.body;
  const markdown = `${frontmatterYaml}\n${newBody}\n`;

  const markdownPath = `content/posts/${params.slug}.md`;

  try {
    const result = await commitFiles(
      [{ path: markdownPath, content: markdown, isBase64: false }],
      `Edit journal post: ${params.slug}`
    );
    return NextResponse.json({
      ok: true,
      slug: params.slug,
      postUrl: `/journal/${params.slug}`,
      commitSha: result.commitSha,
      commitUrl: result.commitUrl,
    });
  } catch (err) {
    console.error("[/api/admin/posts/PATCH] commit failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Commit failed" },
      { status: 502 }
    );
  }
}
