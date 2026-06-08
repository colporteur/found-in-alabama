// System prompt + user message builders for the social copy generator.
//
// Design choice: one Claude call returns ALL requested channels at once
// as a single JSON object. This is cheaper (one image input) and lets
// Claude vary the opener across channels in the same generation so we
// don't ship six posts that all start the same way.

import type { ChannelKey } from "@/lib/social/channel-styles";
import { CHANNELS, channelLabel } from "@/lib/social/channel-styles";

const SITE_URL = "https://www.foundinalabama.com";

export type SocialContentType = "just-listed" | "new-haul" | "throwback" | "just-sold";

const CONTENT_TYPE_LABELS: Record<SocialContentType, string> = {
  "just-listed": "Just-listed item (one product, freshly listed across marketplaces)",
  "new-haul": "New haul announcement (a whole estate/auction story with multiple items coming)",
  throwback: "Throwback (an older haul or item, with a fresh angle)",
  "just-sold": "Just-sold (item just went to a buyer)",
};

/** Source: a single inventory item the seller wants to promote. */
export type ItemSource = {
  kind: "item";
  title: string;
  /** Public URL to the item's hero image. */
  heroImage: string | null;
  /** Decimal price as a string, e.g. "24.00". */
  price: string | null;
  /** Map of marketplace key → public URL. */
  marketplaceUrls: Record<string, string>;
  /** If the item is linked to a haul, the haul's title + slug (for context). */
  haulTitle?: string;
  haulSlug?: string;
  haulExcerpt?: string;
};

/** Source: a haul post (one journal post about a buying expedition). */
export type HaulSource = {
  kind: "haul";
  title: string;
  slug: string;
  date: string;
  excerpt: string;
  /** Plain-text body (no HTML). */
  body: string;
  heroImage: string | null;
  /** Total number of items captured from this haul, if known. */
  itemCount?: number;
};

export type SocialSource = ItemSource | HaulSource;

/**
 * Pick the most useful public URL for a source — the one we want Claude
 * to invite readers toward. For hauls this is the journal post; for
 * items it's the first available marketplace listing (eBay preferred).
 * Returns null when no URL is available (Claude will skip the link).
 */
export function sourceUrl(source: SocialSource): string | null {
  if (source.kind === "haul") {
    return `${SITE_URL}/journal/${source.slug}`;
  }
  const urls = source.marketplaceUrls;
  return (
    urls.ebay ??
    urls.etsy ??
    urls.poshmark ??
    urls.mercari ??
    urls.depop ??
    urls.whatnot ??
    null
  );
}

// ─── System prompt ───────────────────────────────────────────────────────────

const VOICE_RULES = `# Voice rules (apply across all channels)

DO:
- Be specific. Name the brand, the era, the material, the place when you can see or know it. "1970s avocado-green Pyrex bowl" beats "vintage bowl."
- Note at least one visible detail from the photo in every post — it proves you actually looked.
- Sound like a person, not a marketing department.
- Use Southern phrasing only when it falls in naturally. "Y'all" is OK occasionally; "fixin' to" is not.
- Use em-dashes the way actual people use them — sparingly. Don't pepper every post with three of them.

DON'T:
- "Looking for a new home"
- "Don't miss out" / "Won't last long" / "Grab it before it's gone"
- "DM us!" or "Tap the link in bio!" (Instagram-story and Pinterest descriptions can break this if it really fits)
- "Amazing find" / "treasure hunt" / "thrift haul" / "estate sale gem" — all overused
- Exclamation points on the sales pitch
- Leading with the product name ("This bookcase…") — boring
- Repeating the post title verbatim inside the body
- Using the same opener hook across multiple channels in the same generation`;

const HOOK_PATTERNS = `# Hook patterns (vary across channels)

For each channel that gets a 'text' field, pick a DIFFERENT opener pattern than the other channels in this generation. Choose from:
- Visual detail first ("Hand-stitched binding on this one.")
- Question ("When did you last see a working Polaroid this clean?")
- Mini-story ("Came out of a Anniston den that hadn't been cracked open since 1992.")
- Era / place hook ("Made in West Germany. Found in a Birmingham basement.")
- Price-vs-value ("Twenty-four dollars for something that ran two hundred new.")
- Object-as-character ("This Pyrex bowl has been somebody's potluck dish for forty years.")
- Confession ("I almost left this one in the box.")

Don't announce the pattern. Just use it.`;

const CHANNEL_RULES = `# Channel rules — output exactly the shape shown for each requested channel

## instagram_feed
{ "text": string, "hashtags": string[] }
- 80–220 words.
- First-person plural ("we found...") matches Todd's voice.
- Sentence fragments are fine.
- End with a soft pointer to where it's listed (e.g. "On eBay" or "Available on Etsy"). No "link in bio." DO NOT include the source URL — URLs aren't clickable in Instagram captions and would just look like noise.
- 8–12 hashtags. Mix broad (#estatesale, #vintagestyle), niche/item-specific (#midcenturybrass, #goldenagedetectives, #pyrexlove), and local (#alabamavintage, #birminghamantiques, #southernfinds, #shopalabama). All lowercase. No spaces. Don't use # inside the text — only in the hashtags array.

## instagram_story
{ "overlay_text": string, "cta": string }
- overlay_text: ≤8 words, looks good big on an image.
- cta: short, e.g. "Tap for the link," "Listed in bio," "Swipe up." Pick what fits.
- DO NOT include the source URL anywhere — the link gets attached as a story sticker separately.

## facebook
{ "text": string }
- 100–250 words.
- Conversational, local-community feel. If the source mentions a town (Anniston, Birmingham, Tuscaloosa, etc.), lean into it.
- Story-first. "We just got back from..." or "This came out of..." is fine.
- 0–2 hashtags inline, only if natural.
- If a source URL is provided, end the post with the URL on its own line. Facebook auto-generates a preview card for it — that's the point.

## pinterest
{ "title": string, "description": string, "board_suggestion": string }
- title: 50–60 chars max. Keyword-dense for search. NO first person. Pattern: [era] [material/style] [item] — [extra detail]. Example: "1973 Heywood-Wakefield walnut end table — mid-century modern."
- description: 200–400 chars. Searchable. Mention materials, era, condition cues, what room/style it pairs with. Keywords matter more than voice.
- board_suggestion: one short board name where this pin belongs. Examples: "Mid-century finds", "Vintage Pyrex", "Alabama estate hauls", "Vintage books & ephemera".
- DO NOT include the source URL in the description — Pinterest pins have a separate destination URL field that handles it.

## bluesky
{ "text": string }
- ≤300 characters total (count carefully — URL counts toward the limit even though BlueSky shortens its display).
- One observation. Conversational. No hashtags.
- If a source URL is provided, end the post with the URL on its own line. Budget for it: leave at least 50 chars before the URL so the post itself isn't squeezed.

## twitter
{ "text": string }
- ≤270 characters total including the URL (t.co shortens to ~23 chars but the API still counts the original — budget conservatively).
- Punchy. Lead with the hook (surprise, value, question).
- 0–2 hashtags inline only if they read naturally.
- If a source URL is provided, end the tweet with it on its own line.`;

export function buildSystemPrompt(): string {
  return `You write social media posts for "Found in Alabama," a small Alabama-based reseller of estate finds, books, vintage, ephemera, and small antiques. They sell across six marketplaces: eBay, Etsy, Poshmark, Mercari, Depop, and Whatnot.

You will be given:
1. A source — either a single ITEM (a product they're listing) or a HAUL (a journal post about a buying expedition with multiple items).
2. A photo of the item or haul (always present).
3. A content type (just-listed, new-haul, throwback, or just-sold) — adjust the angle accordingly.
4. Recent journal posts from the seller as voice samples — match this voice.
5. A list of channels to generate for.

Generate one post per requested channel as a single JSON object. Output ONLY the JSON object. No code fences, no preamble.

${VOICE_RULES}

${HOOK_PATTERNS}

${CHANNEL_RULES}

# Output format

Return one JSON object whose keys are exactly the requested channel names (e.g. { "instagram_feed": {...}, "facebook": {...} }). Include only the channels requested. No commentary, no code fences, no preamble.`;
}

// ─── User message builder ────────────────────────────────────────────────────

function describeSource(source: SocialSource): string {
  const url = sourceUrl(source);
  const urlLine = url
    ? `Source URL (include where the per-channel rules say to): ${url}`
    : "Source URL: (none — skip the URL block in every channel)";

  if (source.kind === "item") {
    const marketplaceList = Object.keys(source.marketplaceUrls).join(", ");
    return `SOURCE: single item
Title: ${source.title}
${source.price ? `Price: $${source.price}` : "Price: not provided"}
${marketplaceList ? `Listed on: ${marketplaceList}` : "Listed on: (no marketplace links captured)"}
${
  source.haulTitle
    ? `From the haul: "${source.haulTitle}"${source.haulExcerpt ? ` — ${source.haulExcerpt}` : ""}`
    : ""
}
${urlLine}`.trim();
  }
  return `SOURCE: haul (multi-item journal post)
Title: ${source.title}
Posted: ${source.date}
${source.excerpt ? `Excerpt: ${source.excerpt}` : ""}
${typeof source.itemCount === "number" ? `Items captured from this haul so far: ${source.itemCount}` : ""}
${urlLine}

Full haul narrative:
${source.body}`.trim();
}

export function buildUserMessage({
  source,
  contentType,
  channels,
  voiceSamplesBlock,
}: {
  source: SocialSource;
  contentType: SocialContentType;
  channels: ChannelKey[];
  voiceSamplesBlock: string;
}): string {
  const channelList = channels
    .map((c) => `- ${c} (${channelLabel(c)}): ${CHANNELS[c].blurb}`)
    .join("\n");

  return `${voiceSamplesBlock ? voiceSamplesBlock + "\n\n" : ""}Content type: ${CONTENT_TYPE_LABELS[contentType]}

${describeSource(source)}

Generate posts for these channels:
${channelList}

Return one JSON object whose top-level keys are exactly: ${channels.map((c) => `"${c}"`).join(", ")}.`;
}
