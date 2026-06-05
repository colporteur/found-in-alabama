// Tiny helper for looking up the set of published journal post slugs.
// Used by the capture endpoint to validate that a Nifty private-note
// string actually corresponds to a real haul post before linking items
// to it.

import { getAllPosts } from "@/lib/posts";

/**
 * Returns the set of published post slugs (haul, live sale, travel —
 * all types). Cached per process; cheap to call repeatedly.
 */
let _cache: Set<string> | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 60_000; // refresh once a minute

export function getKnownSlugs(): Set<string> {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;
  const posts = getAllPosts();
  _cache = new Set(posts.map((p) => p.slug));
  _cacheAt = now;
  return _cache;
}

/**
 * Normalize a private-notes string and return it if it matches a
 * published slug. Returns null otherwise (no fuzzy matching — exact only).
 */
export function privateNotesToHaulSlug(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const trimmed = notes.trim().toLowerCase();
  if (!trimmed) return null;
  // If the user puts multiple things separated by comma/whitespace, take
  // the first kebab-case-looking token.
  const token = trimmed.split(/[\s,]+/)[0];
  if (!/^[a-z0-9-]+$/.test(token)) return null;
  return getKnownSlugs().has(token) ? token : null;
}
