// Write with Claude (connector side): the tools that let Claude in the Claude
// app write the listing drafts Todd queued with "Send to Claude". Offered only
// on connections where Todd turned listing writing on (/admin/connect).
// The one write is listing_save, which puts a draft in Todd's Review queue;
// nothing here approves, sends to Nifty or publishes.

import { argStr, rawContent, type ToolDef } from "./protocol";
import {
  claudeCategorySpecifics,
  claudeDraftPacket,
  claudeFindCategories,
  claudeFindGuide,
  claudeGuideById,
  claudeQueue,
  saveClaudeWrite,
} from "@/lib/listings/claude";
import { CONDITIONS } from "@/lib/listings/rules";

export function listingTools(who: string): ToolDef[] {
  return [
    {
      name: "listing_queue",
      title: "Listing drafts waiting for Claude",
      description:
        "The listing drafts Todd sent to Claude to write (oldest first): id, his title hint, where it came from, bin, photo count and any instructions he left. Work through them one at a time with listing_get_draft → (listing_category_specifics) → listing_save.",
      inputSchema: { type: "object", properties: { limit: { type: "number", default: 20 } } },
      run: async (a) => claudeQueue(Math.max(1, Math.min(50, Number(a.limit) || 20))),
    },
    {
      name: "listing_get_draft",
      title: "Get a draft to write",
      description:
        "Everything needed to write one queued draft: Todd's instructions, intake facts, the matched Expert Guide(s), the eBay supply snapshot and pricing policy, candidate eBay categories, the store's shelves, the writing rules and the expected fields — followed by the photos. Look at every photo (backs, labels, postmarks) before writing. You may use web search to identify places, makers and dates, but only state as fact what the photos or facts show; hedge anything else.",
      inputSchema: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] },
      run: async (a) => rawContent(await claudeDraftPacket(argStr(a, "draft_id", 40) ?? "")),
    },
    {
      name: "listing_find_categories",
      title: "Find eBay categories",
      description: "Search the eBay categories this store already lists in, by words (e.g. 'postcard alabama', 'vinyl gospel', 'trade card'). Returns ids for listing_save.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      run: async (a) => claudeFindCategories(argStr(a, "query", 120) ?? ""),
    },
    {
      name: "listing_find_guide",
      title: "Find an Expert Guide",
      description:
        "Todd's Expert Guides (title formulas, pricing rules, item-specifics maps by item type). With words: the best-matching guide(s) in full. With no words: the list of all guides. Use a guide by id with listing_get_guide.",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      run: async (a) => claudeFindGuide(argStr(a, "query", 200) ?? ""),
    },
    {
      name: "listing_get_guide",
      title: "Get an Expert Guide",
      description: "One Expert Guide by id (from listing_find_guide).",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: async (a) => claudeGuideById(argStr(a, "id", 120) ?? ""),
    },
    {
      name: "listing_category_specifics",
      title: "Item specifics for a category",
      description: "The real eBay item-specific fields for a category id: required / recommended / optional, one or several values, and allowed values where eBay restricts them. Use exact field names and values in listing_save.",
      inputSchema: { type: "object", properties: { category_id: { type: "string" } }, required: ["category_id"] },
      run: async (a) => claudeCategorySpecifics(argStr(a, "category_id", 20) ?? ""),
    },
    {
      name: "listing_save",
      title: "Save the written listing",
      readOnly: false,
      description:
        "Save the listing you wrote for a queued draft. FIA cleans the title/description, applies the price rules (.87 endings, floors, Poshmark floor), keeps only item specifics that are real fields for the category, sets weight and shipping profile, and moves the draft to Todd's Review queue. Returns what was saved and any flags. Nothing is approved or published.",
      inputSchema: {
        type: "object",
        required: ["draft_id", "title", "description", "condition", "price"],
        properties: {
          draft_id: { type: "string" },
          title: { type: "string", description: "≤ 80 characters; aim for 70–80" },
          description: { type: "string", description: "Plain text, ≤ 1,400 characters; first paragraph says what it is + a condition sentence" },
          condition: { type: "string", enum: CONDITIONS },
          condition_note: { type: "string" },
          ebay_category_id: { type: "string" },
          ebay_category_suggestion: { type: "string", description: "Path you'd use if none of the store's categories fits" },
          store_category_ids: { type: "array", items: { type: "string" }, maxItems: 2 },
          item_specifics: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } },
          price: { type: "number" },
          price_low: { type: "number" },
          price_high: { type: "number" },
          price_rationale: { type: "string" },
          confidence: { type: "number", description: "0–1" },
          flags: { type: "array", items: { type: "string" }, description: "Things Todd should check before approving" },
          guides_used: { type: "array", items: { type: "string" } },
          identification: {
            type: "object",
            description: "What the item is, for the price rules and weight",
            properties: {
              identification: { type: "string" },
              kind: { type: "string", enum: ["postcard", "photograph", "ephemera", "book", "magazine", "record", "artwork", "trading_card", "greeting_card", "map", "document", "other"] },
              card_type: { type: "string", enum: ["rppc", "early", "whiteborder", "linen", "chrome", "holiday", "other", "nonpostcard"] },
              era: { type: "string" },
              places: { type: "array", items: { type: "string" } },
              keywords: { type: "array", items: { type: "string" } },
              est_value_usd: { type: "number" },
              notes: { type: "string" },
            },
          },
        },
      },
      run: async (a) => {
        const id = argStr(a, "draft_id", 40) ?? "";
        const { draft_id: _drop, ...listing } = a;
        void _drop;
        return saveClaudeWrite(id, listing, who);
      },
    },
  ];
}
