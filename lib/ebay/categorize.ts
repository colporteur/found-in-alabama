// Claude prompt + scoring for re-categorizing eBay listings out of the
// "Other" bucket. Uses Haiku for speed/cost — this is a constrained
// classification task, not creative writing, so the small model is fine.
//
// Strongly biases toward Alabama-flagged categories when an item has
// Alabama relevance (state name, place name, team, author, etc.).

import { getClaude } from "@/lib/claude";

export const CATEGORIZE_MODEL = "claude-haiku-4-5-20251001";

export interface CategoryOption {
  id: string;
  name: string;
  isAlabama: boolean;
}

export interface SuggestionResult {
  primaryCategoryId: string | null;
  secondaryCategoryId: string | null;
  confidence: number; // 0.0 - 1.0
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
}

const SYSTEM_PROMPT = `You're helping the eBay store "Found in Alabama" — an Alabama-based reseller — clean up listings sitting in the "Other" store category by assigning them to a more specific store category.

You'll receive:
- A listing's title (and possibly an image)
- The seller's full list of available store categories, formatted as: ID<TAB>[AL] Name (the [AL] prefix marks Alabama-related categories)

Your task: pick the single best-fitting category for the listing.

Rules:
- Strongly prefer Alabama-flagged categories when the title or image references the state, an Alabama city, an Alabama university or sports team, an Alabama-born author, or any other Alabama connection.
- Otherwise, pick the most specific category that fits. "Modern Trading Card Games" beats "Toys" if both exist.
- If no category fits well, return primaryCategoryId: null and explain in reasoning. Confidence should reflect that.
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
  imageUrl?: string | null;
  categories: CategoryOption[];
}): Promise<SuggestionResult> {
  const claude = getClaude();

  const lines = input.categories
    .map((c) => `${c.id}\t${c.isAlabama ? "[AL] " : ""}${c.name}`)
    .join("\n");

  const userText = `Listing title: ${input.title}

Available store categories (id<TAB>[AL=Alabama-flagged] name):
${lines}

Return your JSON suggestion.`;

  const content: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source:
          | { type: "url"; url: string }
          | { type: "base64"; media_type: string; data: string };
      }
  > = [];

  if (input.imageUrl) {
    content.push({
      type: "image",
      source: { type: "url", url: input.imageUrl },
    });
  }
  content.push({ type: "text", text: userText });

  const response = await claude.messages.create({
    model: CATEGORIZE_MODEL,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text block");
  }

  const cleaned = textBlock.text
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
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
