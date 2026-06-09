// Publer posting adapter.
//
// Handles Instagram (feed + stories), Facebook, and X via Publer's
// multi-channel API. Each ChannelKey maps to one Publer account via the
// publer_accounts cache table (set in the settings UI). At post time we
// look up the mapped account and publish.
//
// Publer takes a public image URL rather than uploaded bytes, so we
// rely on PostInput.imageSrc being an absolute URL (the router uses
// absolutizeImageSrc to ensure that).

import {
  accountForChannel,
  createPost,
  isConfigured as isPublerConfigured,
} from "@/lib/publer/api";
import type {
  PostingAdapter,
  PostInput,
  PostResult,
} from "@/lib/posting/types";
import type { ChannelKey } from "@/lib/social/channel-styles";

const PUBLER_CHANNELS: ChannelKey[] = [
  "instagram_feed",
  "instagram_story",
  "facebook",
  "twitter",
];

function pickText(content: Record<string, unknown>): string {
  // Each channel shape has a different "main text" field. Hashtags get
  // appended when present (Instagram feed convention).
  if (typeof content.text === "string") {
    const text = content.text as string;
    if (Array.isArray(content.hashtags) && content.hashtags.length > 0) {
      const tags = (content.hashtags as string[]).join(" ");
      return `${text}\n\n${tags}`;
    }
    return text;
  }
  if (typeof content.overlay_text === "string") {
    // IG story — short overlay + CTA.
    return `${content.overlay_text}${content.cta ? `\n${content.cta}` : ""}`;
  }
  if (typeof content.title === "string") {
    return `${content.title}${content.description ? `\n\n${content.description}` : ""}`;
  }
  return "";
}

export const publerAdapter: PostingAdapter = {
  id: "publer",
  label: "Publer",
  handles: PUBLER_CHANNELS,

  readinessIssue() {
    if (!isPublerConfigured()) {
      return "Publer not configured. Set PUBLER_API_KEY and PUBLER_WORKSPACE_ID env vars, then connect at /admin/settings/posting.";
    }
    return null;
  },

  async post(input: PostInput): Promise<PostResult> {
    const text = pickText(input.content).trim();
    if (!text) {
      return { ok: false, error: "Draft has no postable text." };
    }

    const acct = await accountForChannel(input.channel);
    if (!acct) {
      return {
        ok: false,
        error: `No Publer account mapped to "${input.channel}". Visit /admin/settings/posting → Publer and pick one.`,
      };
    }

    if (!input.imageSrc && input.channel !== "twitter") {
      // X allows text-only posts; Instagram/Facebook generally need media.
      return {
        ok: false,
        error: `${input.channel} requires an image — this source has no hero photo.`,
      };
    }

    const postType: "story" | "feed" =
      input.channel === "instagram_story" ? "story" : "feed";

    try {
      const created = await createPost({
        accountId: acct.accountId,
        text,
        imageUrl: input.imageSrc,
        link: input.sourceUrl,
        postType,
      });
      const postId =
        (typeof created.id === "string" && created.id) ||
        (typeof created.job_id === "string" && created.job_id) ||
        null;
      // If Publer accepted the request (2xx) but returned no usable id,
      // surface that as a soft failure — odds are the post landed in
      // drafts or got silently dropped. The full response goes into the
      // error so we can see exactly what Publer said.
      if (!postId) {
        return {
          ok: false,
          error: `Publer accepted the request but returned no post id. Check Publer's Drafts and Scheduled views. Raw response: ${JSON.stringify(created).slice(0, 500)}`,
        };
      }
      return {
        ok: true,
        postId,
        postUrl: typeof created.url === "string" ? created.url : null,
      };
    } catch (err) {
      return {
        ok: false,
        error: `Publer post failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  },
};
