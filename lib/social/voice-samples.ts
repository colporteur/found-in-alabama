// Pulls the 3 most recent journal posts and turns them into plain-text
// "voice anchor" excerpts the system prompt can inject. Claude reads
// these to match your existing writing style instead of defaulting to
// generic-reseller voice.

import { getRecentPosts } from "@/lib/posts";

const MAX_SAMPLES = 3;
const SAMPLE_CHAR_LIMIT = 600;

export type VoiceSample = {
  title: string;
  excerpt: string;
  body: string; // plain-text, truncated
};

/** Strip HTML tags from a string. Good enough for our marked-rendered HTML. */
function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|h\d|li|br)>/gi, "\n") // turn block ends into newlines
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fetch the most recent journal posts and return them as voice samples.
 * Each sample is title + excerpt + first ~600 chars of plain-text body.
 * Skips a post if it has no body (rare, but defensive).
 */
export function getVoiceSamples(): VoiceSample[] {
  const recent = getRecentPosts(MAX_SAMPLES * 2); // overshoot in case we filter some out
  const samples: VoiceSample[] = [];
  for (const post of recent) {
    const plain = stripHtml(post.contentHtml ?? "");
    if (!plain) continue;
    samples.push({
      title: post.title,
      excerpt: post.excerpt ?? "",
      body:
        plain.length > SAMPLE_CHAR_LIMIT
          ? plain.slice(0, SAMPLE_CHAR_LIMIT).trimEnd() + "…"
          : plain,
    });
    if (samples.length >= MAX_SAMPLES) break;
  }
  return samples;
}

/** Format voice samples as a prompt section. Returns empty string if none. */
export function formatVoiceSamplesPrompt(samples: VoiceSample[]): string {
  if (samples.length === 0) return "";
  const blocks = samples
    .map(
      (s, i) =>
        `--- Voice sample ${i + 1} ---\nTitle: ${s.title}\n${s.excerpt ? `Excerpt: ${s.excerpt}\n` : ""}Body:\n${s.body}`
    )
    .join("\n\n");
  return `Here are recent journal posts from this seller. Match this voice — same warmth, same specificity, same restraint. Do not quote them verbatim.\n\n${blocks}`;
}
