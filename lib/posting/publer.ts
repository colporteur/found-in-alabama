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
  waitForJob,
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

    let acct = await accountForChannel(input.channel);
    // Stories go to the same Instagram account as feed posts, and the
    // settings UI maps each Publer account to a single channel — so when
    // instagram_story has no explicit mapping, reuse the feed account.
    if (!acct && input.channel === "instagram_story") {
      acct = await accountForChannel("instagram_feed");
    }
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
        provider: acct.provider,
        text,
        imageUrl: input.imageSrc,
        link: input.sourceUrl,
        postType,
      });
      const jobId =
        (typeof created.job_id === "string" && created.job_id) ||
        (typeof created.id === "string" && created.id) ||
        null;

      // Publer creates posts asynchronously: the create call returns a
      // job_id that we then poll to find out if the post actually got
      // queued or if Publer's background worker rejected it.
      if (!jobId) {
        return {
          ok: false,
          error: `Publer accepted the request but returned no job id. Raw response: ${JSON.stringify(created).slice(0, 500)}`,
        };
      }

      const final = await waitForJob(jobId);
      const status = (typeof final.status === "string" ? final.status : "").toLowerCase();
      if (status === "complete" || status === "completed" || status === "success") {
        // "complete" only means the job ran — individual accounts can
        // still fail. Non-empty failures = our post failed.
        const failures = final.failures;
        if (Array.isArray(failures) && failures.length > 0) {
          // Pull human-readable messages when present, e.g.
          // {failure: {message: "Post type is not valid", ...}}
          const messages = failures
            .map((f) => {
              const entry = f as { failure?: { message?: string }; message?: string };
              return entry.failure?.message ?? entry.message;
            })
            .filter((m): m is string => typeof m === "string");
          return {
            ok: false,
            error: `Publer job ${jobId} completed with failures: ${
              messages.length > 0
                ? messages.join("; ")
                : JSON.stringify(failures).slice(0, 800)
            }`,
          };
        }
        // Try to extract the platform post id / url from the payload.
        const payload = final.payload as
          | {
              posts?: Array<{ id?: string; url?: string; post_link?: string }>;
            }
          | undefined;
        const first = payload?.posts?.[0];
        const postUrl = first?.post_link ?? first?.url;
        return {
          ok: true,
          postId: first?.id ?? jobId,
          postUrl: typeof postUrl === "string" ? postUrl : null,
        };
      }
      if (status === "failed" || status === "error") {
        return {
          ok: false,
          error: `Publer job ${jobId} failed: ${JSON.stringify(final.failures ?? final.payload ?? final.message ?? final).slice(0, 800)}`,
        };
      }
      // Timed out without a terminal status — could be still queued.
      return {
        ok: false,
        error: `Publer job ${jobId} did not finish within the poll timeout. Last status: "${final.status ?? "(unknown)"}". Check Publer's UI to see what happened, then re-arm if needed.`,
      };
    } catch (err) {
      return {
        ok: false,
        error: `Publer post failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  },
};
