// Shared helpers for the Google Merchant Center feeds
// (/api/tes/merchant-feed, /api/fia/merchant-feed).
//
// Splitting: a full feed can pass Vercel's ~4.5 MB function response cap.
// Add ?part=N&of=M to get every M-th item starting at N (1-based), sorted
// by item id so parts are stable between fetches. In Merchant Center, add one
// scheduled-fetch data source per part (…?part=1&of=3, …?part=2&of=3, …).
// No params = the whole feed.

export function feedPart(url: string): { part: number; of: number } {
  const sp = new URL(url).searchParams;
  const of = Math.min(20, Math.max(1, Math.floor(Number(sp.get("of")) || 1)));
  const part = Math.min(of, Math.max(1, Math.floor(Number(sp.get("part")) || 1)));
  return { part, of };
}

/** Keep the items belonging to this part (input order must be stable). */
export function inPart<T>(rows: T[], p: { part: number; of: number }): T[] {
  if (p.of <= 1) return rows;
  return rows.filter((_, i) => i % p.of === p.part - 1);
}

/** Descriptions are trimmed to this many characters to keep feeds small. */
export const FEED_DESCRIPTION_CHARS = 1500;
