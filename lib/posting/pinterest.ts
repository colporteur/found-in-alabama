// Pinterest posting adapter using API v5.
//
// Required env vars:
//   PINTEREST_CLIENT_ID
//   PINTEREST_CLIENT_SECRET
//   PINTEREST_REDIRECT_URI
//   PINTEREST_OAUTH_STATE_SECRET
//
// Plus a one-time OAuth handshake at /admin/settings/posting/pinterest/connect
// before any post will work.

import {
  createPin,
  resolveBoardId,
} from "@/lib/pinterest/api";
import {
  getValidAccessToken,
  isConfigured as isOAuthConfigured,
} from "@/lib/pinterest/oauth";
import type {
  PostingAdapter,
  PostInput,
  PostResult,
} from "@/lib/posting/types";

export const pinterestAdapter: PostingAdapter = {
  id: "pinterest",
  label: "Pinterest",
  handles: ["pinterest"],

  readinessIssue() {
    if (!isOAuthConfigured()) {
      return "Pinterest OAuth env vars not set. Add PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET, PINTEREST_REDIRECT_URI, and PINTEREST_OAUTH_STATE_SECRET, then connect at /admin/settings/posting.";
    }
    return null;
  },

  async post(input: PostInput): Promise<PostResult> {
    if (!input.image) {
      return {
        ok: false,
        error:
          "Pinterest requires an image. This source has no hero image — capture one and try again.",
      };
    }
    // We can't post without an active OAuth connection. Surface this as
    // a friendly error rather than letting Pinterest 401.
    const token = await getValidAccessToken();
    if (!token) {
      return {
        ok: false,
        error:
          "Pinterest is not connected. Visit /admin/settings/posting and click Connect.",
      };
    }

    const title = pickField(input.content, "title", input.sourceTitle).slice(
      0,
      100
    );
    const description = pickField(input.content, "description", "");
    const boardSuggestion = pickField(input.content, "board_suggestion", "");

    if (!description) {
      return {
        ok: false,
        error:
          "Pinterest draft has no description field — regenerate the draft and try again.",
      };
    }

    const boardId = await resolveBoardId(boardSuggestion || null);
    if (!boardId) {
      return {
        ok: false,
        error:
          "No Pinterest boards cached. Visit /admin/settings/posting and click Sync boards.",
      };
    }

    try {
      const created = await createPin({
        board_id: boardId,
        title,
        description,
        link: input.sourceUrl,
        alt_text: input.sourceTitle.slice(0, 500),
        image_base64: {
          data: input.image.data.toString("base64"),
          content_type: input.image.mediaType,
        },
      });
      return {
        ok: true,
        postId: created.id,
        // Pinterest doesn't always return a `url`; construct the canonical
        // pin URL from the id.
        postUrl: created.url ?? `https://www.pinterest.com/pin/${created.id}/`,
      };
    } catch (err) {
      return {
        ok: false,
        error: `Pinterest create-pin failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  },
};

function pickField(
  content: Record<string, unknown>,
  key: string,
  fallback: string
): string {
  const v = content[key];
  if (typeof v === "string") return v;
  return fallback;
}
