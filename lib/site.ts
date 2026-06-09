// Site-wide constants. Kept in one place so we don't drift across files.

/** Canonical public site URL — no trailing slash. */
export const SITE_URL = "https://www.foundinalabama.com";

/**
 * Make an image src absolute. Returns the input unchanged if it already
 * is, or prepends SITE_URL if it's a /photos/... root-relative path. We
 * need absolute URLs to hand to APIs (Publer, Pinterest, etc.) that
 * fetch the image from our server rather than accepting a base64 upload.
 */
export function absolutizeImageSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  if (src.startsWith("/")) return `${SITE_URL}${src}`;
  return `${SITE_URL}/${src}`;
}
