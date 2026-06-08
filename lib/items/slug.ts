// Slug generation for items. Used by the capture API to assign each new
// item a kebab-case URL segment based on its title. Once assigned, a
// slug is permanent — public URLs published to social media must not
// break.

import { db, items } from "@/db";
import { and, eq, ne } from "drizzle-orm";

const MAX_BASE_LEN = 60;
const MAX_SLUG_LEN = 80;

/**
 * Kebab-case the title, drop non-alphanumerics, collapse runs of dashes,
 * trim to MAX_BASE_LEN. Does NOT check uniqueness — see ensureUniqueSlug.
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['"’]/g, "") // strip apostrophes so "world's" → "worlds"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LEN);
}

/**
 * Return a slug that doesn't collide with any other item's slug.
 * If the base slug is taken by a DIFFERENT item, appends -2, -3, ...
 * until we find a free one.
 *
 * @param base       The kebab-case base slug from slugifyTitle().
 * @param excludeId  Item id to ignore when checking uniqueness — used
 *                   on upsert so we don't collide with the row we're
 *                   updating.
 */
export async function ensureUniqueSlug(
  base: string,
  excludeId?: string
): Promise<string> {
  let candidate = base || "item";
  // Cap at MAX_SLUG_LEN to leave room for a suffix
  if (candidate.length > MAX_SLUG_LEN - 4) {
    candidate = candidate.slice(0, MAX_SLUG_LEN - 4);
  }

  for (let suffix = 1; suffix < 1000; suffix++) {
    const tryThis = suffix === 1 ? candidate : `${candidate}-${suffix}`;
    const conflict = await db
      .select({ id: items.id })
      .from(items)
      .where(
        excludeId
          ? and(eq(items.slug, tryThis), ne(items.id, excludeId))
          : eq(items.slug, tryThis)
      )
      .limit(1);
    if (conflict.length === 0) return tryThis;
  }
  // Pathological case — fall back to a uuid-based slug
  return `${candidate}-${Date.now()}`;
}

/**
 * Build a slug given a title. Convenience wrapper around slugifyTitle +
 * ensureUniqueSlug.
 */
export async function buildSlug(
  title: string,
  excludeId?: string
): Promise<string> {
  return ensureUniqueSlug(slugifyTitle(title), excludeId);
}
