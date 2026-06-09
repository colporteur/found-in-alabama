// Shared types + adapter interface for the auto-posting system.
//
// Each platform (BlueSky, Pinterest, Publer, …) implements PostingAdapter.
// lib/posting/index.ts routes a draft to the right adapter based on its
// ChannelKey and the adapter's `handles` list.

import type { ChannelKey } from "@/lib/social/channel-styles";

/** The image we hand to an adapter (already loaded into memory). */
export type LoadedImage = {
  data: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
};

/** What we pass to an adapter to publish. */
export type PostInput = {
  /** Channel this is being posted to. */
  channel: ChannelKey;
  /**
   * Per-channel JSON shape from Claude (matches the `content` jsonb stored
   * on socialDrafts). Adapters know how to read the fields they care about.
   */
  content: Record<string, unknown>;
  /** Source image, already loaded. May be null if the source had no image. */
  image: LoadedImage | null;
  /**
   * Absolute public URL to the source image, if there is one. Adapters
   * like Publer that want to hand a URL to the platform (rather than
   * uploading bytes) read this instead of `image`. Already-absolute http
   * URLs are passed through; root-relative paths are joined to SITE_URL.
   */
  imageSrc: string | null;
  /** Source title (for fallback alt text). */
  sourceTitle: string;
  /**
   * Public URL to send the viewer to (haul page or product page). Used
   * by Pinterest as the pin's destination link, and by future adapters
   * that have a similar "click-through" concept.
   */
  sourceUrl: string | null;
};

/** What an adapter returns after publishing. */
export type PostResult =
  | {
      ok: true;
      /** Platform-specific id (URI, pin id, post id). */
      postId: string;
      /** Public URL to the published post if the platform exposes one. */
      postUrl: string | null;
    }
  | {
      ok: false;
      error: string;
    };

export type PostingAdapter = {
  /** Lowercase id, e.g. "bluesky". */
  id: string;
  /** Human-readable name shown in admin UI. */
  label: string;
  /** Which ChannelKeys this adapter can publish to. */
  handles: ChannelKey[];
  /**
   * Returns null when ready to post; returns a string explaining the
   * setup gap when not (e.g. "Set BLUESKY_HANDLE in env").
   */
  readinessIssue(): string | null;
  /** Publish. */
  post(input: PostInput): Promise<PostResult>;
};
