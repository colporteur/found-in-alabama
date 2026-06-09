// Read the raw markdown + frontmatter of one post for editing.
//
// lib/posts.ts is rendering-oriented — it parses markdown to HTML. For
// the edit form we need the original markdown so the user can edit it
// and we can round-trip it back through gray-matter.

import fs from "fs";
import path from "path";
import matter from "gray-matter";

const postsDir = path.join(process.cwd(), "content/posts");

export type RawPost = {
  slug: string;
  // Frontmatter — read as-is, schema-free so we don't drop unknown keys
  frontmatter: Record<string, unknown>;
  /** Original markdown body, no frontmatter. */
  body: string;
};

export function readRawPost(slug: string): RawPost | null {
  // Filter slugs to prevent path traversal.
  if (!/^[a-z0-9-]+$/i.test(slug)) return null;
  const file = path.join(postsDir, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  const { data, content } = matter(raw);
  return {
    slug,
    frontmatter: data as Record<string, unknown>,
    body: content.trim(),
  };
}
