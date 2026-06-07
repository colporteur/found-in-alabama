// Per-channel rules, JSON output shapes, and display metadata for the
// social copy generator. The system prompt (lib/social/prompts.ts) reads
// from this so we have one canonical place to tune voice, length, and
// hashtag behavior per channel.
//
// Adding a channel: add it to CHANNELS, give it a Style entry, and add a
// matching block to the system prompt's "Channel rules" section.

export type ChannelKey =
  | "instagram_feed"
  | "instagram_story"
  | "facebook"
  | "pinterest"
  | "bluesky"
  | "twitter";

export type ChannelOutput =
  | { kind: "text-with-hashtags"; text: string; hashtags: string[] }
  | { kind: "text"; text: string }
  | { kind: "story"; overlay_text: string; cta: string }
  | { kind: "pinterest"; title: string; description: string; board_suggestion: string };

export type ChannelStyle = {
  key: ChannelKey;
  label: string;
  /** Short subtitle for the channel tab UI. */
  blurb: string;
  /** Soft character budget shown in the UI as a counter. */
  charBudget: number;
  /** Hard character cap that the platform enforces. */
  charLimit: number;
  outputKind: ChannelOutput["kind"];
  /** Whether the UI should render a hashtag chip strip. */
  hasHashtags: boolean;
};

export const CHANNELS: Record<ChannelKey, ChannelStyle> = {
  instagram_feed: {
    key: "instagram_feed",
    label: "Instagram (feed)",
    blurb: "Square photo + caption. Visual detail first, soft marketplace pointer.",
    charBudget: 1200,
    charLimit: 2200,
    outputKind: "text-with-hashtags",
    hasHashtags: true,
  },
  instagram_story: {
    key: "instagram_story",
    label: "Instagram (story)",
    blurb: "Sticker-overlay text + a short CTA.",
    charBudget: 60,
    charLimit: 80,
    outputKind: "story",
    hasHashtags: false,
  },
  facebook: {
    key: "facebook",
    label: "Facebook page",
    blurb: "Story-first, local-community voice. Mention the city if there's one.",
    charBudget: 1400,
    charLimit: 5000,
    outputKind: "text",
    hasHashtags: false,
  },
  pinterest: {
    key: "pinterest",
    label: "Pinterest pin",
    blurb: "SEO title + keyword description. Vertical 2:3 image.",
    charBudget: 400,
    charLimit: 500,
    outputKind: "pinterest",
    hasHashtags: false,
  },
  bluesky: {
    key: "bluesky",
    label: "BlueSky",
    blurb: "≤300 chars. One observation, no hashtags.",
    charBudget: 280,
    charLimit: 300,
    outputKind: "text",
    hasHashtags: false,
  },
  twitter: {
    key: "twitter",
    label: "X / Twitter",
    blurb: "≤270 chars. Punchy hook, maybe 1–2 hashtags if natural.",
    charBudget: 260,
    charLimit: 280,
    outputKind: "text",
    hasHashtags: false,
  },
};

export const CHANNEL_ORDER: ChannelKey[] = [
  "instagram_feed",
  "instagram_story",
  "facebook",
  "pinterest",
  "bluesky",
  "twitter",
];

/** Pretty channel name from a key. */
export function channelLabel(key: ChannelKey): string {
  return CHANNELS[key]?.label ?? key;
}

/** Channels that should be selected by default in the UI. */
export const DEFAULT_CHANNELS: ChannelKey[] = [
  "instagram_feed",
  "instagram_story",
  "facebook",
  "pinterest",
  "bluesky",
  "twitter",
];
