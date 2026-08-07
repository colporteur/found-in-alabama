// Claude prompt + scoring for re-categorizing eBay listings out of the
// "Other" bucket. Uses Haiku for speed/cost — this is a constrained
// classification task, not creative writing, so the small model is fine.
//
// Strongly biases toward Alabama-flagged categories when an item has
// Alabama relevance (state name, place name, team, author, etc.).

import { gatewayChat } from "@/lib/gateway";

// Gateway alias — actual model set in the gateway routing table
// (Admin → AI Models). Seeded to anthropic/claude-haiku-4.5.
export const CATEGORIZE_MODEL = "fia-cheap";

export interface CategoryOption {
  id: string;
  name: string;
  /**
   * Full ancestry, e.g. "Postcards › Christmas & New Year's". A leaf name
   * alone is often ambiguous — the parent carries the noun.
   */
  path?: string;
  isAlabama: boolean;
}

export interface SuggestionResult {
  primaryCategoryId: string | null;
  secondaryCategoryId: string | null;
  confidence: number; // 0.0 - 1.0
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** OpenRouter's billed cost for this call, when reported. */
  costUsd?: number;
}

const SYSTEM_PROMPT = `You're helping the eBay store "Found in Alabama" — an Alabama-based reseller — clean up listings sitting in the "Other" store category by assigning them to a more specific store category.

You'll receive:
- A listing's title (and possibly an image)
- The seller's list of assignable store categories, formatted as: ID<TAB>[AL] Full › Category › Path (the [AL] prefix marks Alabama-related categories)

READ THE PATHS CAREFULLY. Categories are hierarchical and the path is shown parent-first. The last segment alone is often ambiguous — its meaning comes from its ancestors:
- "Postcards › Christmas & New Year's" is for CHRISTMAS POSTCARDS, not for Christmas ornaments, Christmas books, or Christmas decor.
- "Books › Cookbooks" is for cookbooks, not for kitchen equipment.
A listing must match the WHOLE path, not just the leaf name. If an item is a Christmas ornament, "Postcards › Christmas & New Year's" is WRONG even though "Christmas" matches — pick a category whose full path fits the item's actual type, or return null.

Only assignable (childless) categories are listed. Parent categories are deliberately absent because eBay refuses to hold items in them — so if an item is a postcard but no postcard subcategory fits it well, return null rather than forcing a bad subcategory.

Your task: pick the single best-fitting category for the listing.

Rules:
- Strongly prefer Alabama-flagged categories when the title or image references the state, an Alabama city, an Alabama university or sports team, an Alabama-born author, or any other Alabama connection.
- Otherwise, pick the most specific category whose full path fits. "Modern Trading Card Games" beats "Toys" if both exist.
- If no category fits well, return primaryCategoryId: null and explain in reasoning. Confidence should reflect that. A null is much better than a wrong shelf.
- Only return secondaryCategoryId if a second category genuinely adds information (e.g., an Alabama-themed book could go in both an Alabama category AND a fiction category). Otherwise leave it null.
- The two IDs must come from the provided list. Do not invent IDs.

Confidence guide:
- 0.9-1.0: Title makes the category obvious; high specificity.
- 0.7-0.89: Strong fit, minor interpretation.
- 0.5-0.69: Plausible but I'd want a human to glance.
- < 0.5: Weak match; likely needs human review.

Output format: JSON only, no code fences, no preamble. Exact shape:
{
  "primaryCategoryId": "12345" | null,
  "secondaryCategoryId": "67890" | null,
  "confidence": 0.85,
  "reasoning": "1-2 sentence explanation, plain English"
}`;

export async function suggestCategoryForListing(input: {
  title: string;
  /**
   * Image URL is accepted but currently ignored — the Anthropic SDK
   * version pinned in this project (0.32.1) only supports base64 image
   * sources, not URL sources. eBay titles are descriptive enough on
   * their own. We can add base64 image fetching later if classification
   * accuracy on title-only proves insufficient.
   */
  imageUrl?: string | null;
  categories: CategoryOption[];
}): Promise<SuggestionResult> {
  // Sorted by path so siblings sit together — the tree shape is visible
  // in the list itself, which helps far more than raw name order.
  const lines = [...input.categories]
    .sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name))
    .map((c) => `${c.id}\t${c.isAlabama ? "[AL] " : ""}${c.path ?? c.name}`)
    .join("\n");

  // The category list is identical across every item in a run, so it goes
  // in the SYSTEM block behind a cache breakpoint rather than being re-sent
  // (and re-billed at full rate) 1,800 times. Only the title varies.
  const response = await gatewayChat({
    model: CATEGORIZE_MODEL,
    maxTokens: 500,
    system: [
      {
        type: "text",
        text: `${SYSTEM_PROMPT}

Assignable store categories (id<TAB>[AL=Alabama-flagged] full path):
${lines}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    content: `Listing title: ${input.title}

Return your JSON suggestion.`,
  });

  if (!response.text.trim()) {
    throw new Error("Model returned an empty response");
  }

  const cleaned = response.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: Partial<SuggestionResult>;
  try {
    parsed = JSON.parse(cleaned) as Partial<SuggestionResult>;
  } catch {
    throw new Error(`Claude returned non-JSON: ${cleaned.slice(0, 300)}`);
  }

  if (typeof parsed.confidence !== "number") {
    throw new Error("Suggestion missing numeric confidence");
  }

  // Validate that the suggested IDs are real. If Claude hallucinated an
  // ID, drop it back to null rather than crashing the request.
  const validIds = new Set(input.categories.map((c) => c.id));
  const primaryCategoryId =
    parsed.primaryCategoryId && validIds.has(parsed.primaryCategoryId)
      ? parsed.primaryCategoryId
      : null;
  const secondaryCategoryId =
    parsed.secondaryCategoryId && validIds.has(parsed.secondaryCategoryId)
      ? parsed.secondaryCategoryId
      : null;

  return {
    primaryCategoryId,
    secondaryCategoryId,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    reasoning: String(parsed.reasoning ?? "").slice(0, 1000),
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cacheReadTokens: response.usage.cacheReadTokens,
    costUsd: response.usage.costUsd,
  };
}
