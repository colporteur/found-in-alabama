// Router for the auto-posting system. Maps a ChannelKey to the adapter
// that should handle it, and exposes a single postDraft() entry point
// used by both the manual "Post now" route and (eventually) the cron.
//
// To add a new platform: implement PostingAdapter in a new file, import
// it here, add to the ADAPTERS list. The router picks the first adapter
// whose `handles` list includes the requested channel.

import { blueskyAdapter } from "@/lib/posting/bluesky";
import { loadImage } from "@/lib/posting/load-image";
import type {
  PostingAdapter,
  PostResult,
} from "@/lib/posting/types";
import type { ChannelKey } from "@/lib/social/channel-styles";

/** Registry of all known adapters. Order matters — first match wins. */
const ADAPTERS: PostingAdapter[] = [
  blueskyAdapter,
  // Pinterest adapter (Phase 2D-3b) added here later.
  // Publer adapter (Phase 2D-3c) added here later.
];

/** Find the adapter responsible for a channel, or null. */
export function adapterFor(channel: ChannelKey): PostingAdapter | null {
  return ADAPTERS.find((a) => a.handles.includes(channel)) ?? null;
}

/** Returns the full list with per-adapter readiness state. */
export function listAdapters(): Array<{
  id: string;
  label: string;
  handles: ChannelKey[];
  ready: boolean;
  issue: string | null;
}> {
  return ADAPTERS.map((a) => {
    const issue = a.readinessIssue();
    return {
      id: a.id,
      label: a.label,
      handles: a.handles,
      ready: issue === null,
      issue,
    };
  });
}

/** Map ChannelKey → adapter id (or null) for quick lookups. */
export function channelCoverage(): Record<ChannelKey, string | null> {
  const out = {} as Record<ChannelKey, string | null>;
  for (const a of ADAPTERS) {
    for (const c of a.handles) {
      if (!(c in out)) out[c] = a.id;
    }
  }
  return out;
}

/** Post a draft now. Loads the image, picks the adapter, returns the result. */
export async function postDraft({
  channel,
  content,
  sourceImage,
  sourceTitle,
}: {
  channel: ChannelKey;
  content: Record<string, unknown>;
  sourceImage: string | null;
  sourceTitle: string;
}): Promise<PostResult> {
  const adapter = adapterFor(channel);
  if (!adapter) {
    return {
      ok: false,
      error: `No adapter is configured to post to "${channel}" yet.`,
    };
  }
  const issue = adapter.readinessIssue();
  if (issue) {
    return { ok: false, error: issue };
  }
  const image = await loadImage(sourceImage);
  return adapter.post({
    channel,
    content,
    image,
    sourceTitle,
  });
}
