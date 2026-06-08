// BlueSky posting adapter using @atproto/api.
//
// Credentials live in env vars:
//   BLUESKY_HANDLE   — e.g. "foundinalabama.bsky.social" (no leading @)
//   BLUESKY_APP_PASSWORD — generated at https://bsky.app/settings/app-passwords
//
// We log in once per call (BlueSky sessions are cheap to create). For higher
// volume we'd cache the session, but at our cadence this is plenty.

import { AtpAgent } from "@atproto/api";
import type {
  PostingAdapter,
  PostInput,
  PostResult,
} from "@/lib/posting/types";

const SERVICE = "https://bsky.social";
const BLUESKY_CHAR_LIMIT = 300;

function getCredentials(): { handle: string; password: string } | null {
  const handle = process.env.BLUESKY_HANDLE?.trim();
  const password = process.env.BLUESKY_APP_PASSWORD?.trim();
  if (!handle || !password) return null;
  return { handle, password };
}

/**
 * Extract the post text from a draft's content blob. BlueSky takes a
 * single text field; for IG-feed-style drafts (text + hashtags) we
 * concatenate; for the other shapes we use whatever main field exists.
 */
function pickText(content: Record<string, unknown>): string {
  if (typeof content.text === "string") {
    const text = content.text as string;
    if (Array.isArray(content.hashtags) && content.hashtags.length > 0) {
      const tags = (content.hashtags as string[]).join(" ");
      return `${text}\n\n${tags}`;
    }
    return text;
  }
  if (typeof content.overlay_text === "string") {
    return `${content.overlay_text}${content.cta ? `\n${content.cta}` : ""}`;
  }
  if (typeof content.title === "string") {
    return `${content.title}${content.description ? `\n\n${content.description}` : ""}`;
  }
  return "";
}

/** BlueSky counts graphemes — we approximate with .length for now. */
function clipToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  // Try to cut at the last whitespace before the limit so we don't slice
  // mid-word. Fall back to a hard slice + ellipsis.
  const slice = text.slice(0, limit - 1);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > limit * 0.7) {
    return slice.slice(0, lastSpace).trimEnd() + "…";
  }
  return slice.trimEnd() + "…";
}

/**
 * Build the public bsky.app URL for a post given its AT-URI and the
 * authenticated user's handle. URI looks like:
 *   at://did:plc:abc.../app.bsky.feed.post/3jzfcijpj2z2a
 */
function publicUrlFromUri(uri: string, handle: string): string | null {
  const m = uri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/(.+)$/);
  if (!m) return null;
  const [, , rkey] = m;
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

export const blueskyAdapter: PostingAdapter = {
  id: "bluesky",
  label: "BlueSky",
  handles: ["bluesky"],

  readinessIssue() {
    const creds = getCredentials();
    if (!creds) {
      return "BlueSky not configured. Set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD env vars (in Vercel and .env.local).";
    }
    return null;
  },

  async post(input: PostInput): Promise<PostResult> {
    const creds = getCredentials();
    if (!creds) {
      return { ok: false, error: "BlueSky credentials not configured" };
    }
    const text = clipToLimit(pickText(input.content).trim(), BLUESKY_CHAR_LIMIT);
    if (!text) {
      return { ok: false, error: "Draft has no postable text" };
    }

    const agent = new AtpAgent({ service: SERVICE });
    try {
      await agent.login({
        identifier: creds.handle,
        password: creds.password,
      });
    } catch (err) {
      return {
        ok: false,
        error: `BlueSky login failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }

    // Upload image if we have one, then attach as an embed
    let embed: Record<string, unknown> | undefined;
    if (input.image) {
      try {
        const uploaded = await agent.uploadBlob(input.image.data, {
          encoding: input.image.mediaType,
        });
        embed = {
          $type: "app.bsky.embed.images",
          images: [
            {
              alt: input.sourceTitle ?? "",
              image: uploaded.data.blob,
            },
          ],
        };
      } catch (err) {
        // If image upload fails, still post the text — better than nothing
        console.warn(
          "[bluesky] image upload failed, posting text only",
          err instanceof Error ? err.message : err
        );
      }
    }

    try {
      const res = await agent.post({
        text,
        createdAt: new Date().toISOString(),
        ...(embed ? { embed } : {}),
      });
      return {
        ok: true,
        postId: res.uri,
        postUrl: publicUrlFromUri(res.uri, creds.handle),
      };
    } catch (err) {
      return {
        ok: false,
        error: `BlueSky post failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  },
};
