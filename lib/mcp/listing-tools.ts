// Write with Claude (connector side): the tools that let Claude in the Claude
// app write the listing drafts Todd queued with "Send to Claude". Offered only
// on connections where Todd turned listing writing on (/admin/connect).
// The writes are listing_save / listing_revise, which put a draft in Todd's
// Review queue, and listing_combine_lot, which merges drafts Todd sent with
// "combine lots" on into one lot draft, and listing_add_to_lot, which adds
// queued pieces to a lot Todd is holding open; nothing here approves, sends to Nifty
// or publishes.

import { argStr, rawContent, type ToolDef } from "./protocol";
import {
  claudeCategorySpecifics,
  claudeDraftPacket,
  claudeFindCategories,
  claudeFindGuide,
  claudeGuideById,
  claudeLotPhotos,
  claudeMorePhotos,
  claudePool,
  claudePoolAdd,
  claudePoolGroup,
  claudeQueue,
  claudeWritten,
  reviseClaudeWrite,
  saveClaudeWrite,
  allowLotsFromChat,
} from "@/lib/listings/claude";
import { CONDITIONS } from "@/lib/listings/rules";
import { combineLot } from "@/lib/listings/lots";
import { addToLot } from "@/lib/listings/open-lots";
import { completeFixes, fixPhotos, fixQueue, hasOpenFix } from "@/lib/listings/fixes";
import { updateDraft } from "@/lib/listings/drafts";

export function listingTools(who: string): ToolDef[] {
  const tools = buildTools(who);
  const save = tools.find((t) => t.name === "listing_save")!;
  const revise = tools.find((t) => t.name === "listing_revise")!;
  revise.inputSchema = { ...save.inputSchema, required: ["draft_id"] };
  return tools;
}

function buildTools(who: string): ToolDef[] {
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
        "Everything needed to write one queued draft (or to revise one you wrote that's still in Review — then it also shows the current listing): Todd's instructions, intake facts, the matched Expert Guide(s), the eBay supply snapshot and pricing policy, candidate eBay categories, the store's shelves, the writing rules and the expected fields — followed by the photos. Look at every photo (backs, labels, postmarks) before writing. You may use web search to identify places, makers and dates, but only state as fact what the photos or facts show; hedge anything else.",
      inputSchema: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] },
      run: async (a) => rawContent(await claudeDraftPacket(argStr(a, "draft_id", 40) ?? "")),
    },
    {
      name: "listing_get_photos",
      title: "More photos of a draft",
      description:
        "The next photos of a draft (up to 6 at a time) when listing_get_draft says it has more than it showed. Ask only when the rest could change the listing — more pages, a back, a postmark, a maker's mark, another piece of a lot.",
      inputSchema: {
        type: "object",
        required: ["draft_id", "from"],
        properties: {
          draft_id: { type: "string" },
          from: { type: "number", description: "First photo number to show (1-based)" },
          count: { type: "number", default: 6, description: "How many (max 6)" },
        },
      },
      run: async (a) => rawContent(await claudeMorePhotos(argStr(a, "draft_id", 40) ?? "", Number(a.from), Number(a.count ?? 6))),
    },
    {
      name: "listing_lot_photos",
      title: "Choose a folder lot's own photos",
      description:
        "Only for a whole-folder lot (listing_get_draft says Todd sent it as one folder, pieces numbered 1–N). eBay shows 24 photos: photo 1 is a numbered overview of every piece; with more than 23 pieces, neighbouring pieces share merged 2–4-up photos (numbered like the overview), only as many as needed. Give the piece numbers that deserve a photo of their own, best first (the most searchable, valuable or best-condition pieces; listing_get_draft says how many can); FIA re-merges the rest. Nothing is published.",
      inputSchema: {
        type: "object",
        required: ["draft_id", "solo"],
        properties: {
          draft_id: { type: "string" },
          solo: { type: "array", items: { type: "number" }, maxItems: 22, description: "Piece numbers (from the overview) that keep their own photo, best first" },
        },
      },
      run: async (a) =>
        claudeLotPhotos(
          argStr(a, "draft_id", 40) ?? "",
          (Array.isArray(a.solo) ? a.solo : []).map(Number).filter(Number.isInteger).slice(0, 22),
          who
        ),
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
      name: "listing_combine_lot",
      title: "Combine drafts into a lot",
      readOnly: false,
      description:
        "Only for drafts listing_queue marks combineLots: true, all from the same batch — plus, optionally, pooled pieces waiting in Todd's lot pool (pool_member_ids from listing_pool; check it first). Merges them into ONE lot draft (the first draft id): all photos move onto it, FIA makes a cover from each piece's front as photo 1 and fits every scan into eBay's 24 photos (merging scans into 2–4-up photos only when there are more than fit; up to 60 pieces), and the other drafts are set aside (Todd can split the lot again; pool pieces go back to the pool). Combine when price and shared affinity make market sense — pieces worth more together (same city, theme, maker or series) or too cheap to ship alone; keep anything that sells well by itself separate. Then call listing_get_draft on the lot id and write it with listing_save.",
      inputSchema: {
        type: "object",
        required: ["draft_ids", "reason"],
        properties: {
          draft_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 60, description: "Pieces from this batch, best/most representative first (the lot is built on the first)" },
          pool_member_ids: { type: "array", items: { type: "string" }, maxItems: 59, description: "Pooled pieces from listing_pool (memberId) to include" },
          reason: { type: "string", description: "One or two sentences: why these sell better as a lot (shown to Todd)" },
        },
      },
      run: async (a) => {
        const ids = Array.isArray(a.draft_ids) ? (a.draft_ids as unknown[]).map(String) : [];
        const pool = Array.isArray(a.pool_member_ids) ? (a.pool_member_ids as unknown[]).map(String) : [];
        return combineLot(ids, who, argStr(a, "reason", 600), pool);
      },
    },
    {
      name: "listing_allow_lots",
      title: "Turn on lot combining (Todd asked)",
      readOnly: false,
      description:
        "ONLY when Todd has said in this conversation that these drafts may be combined into lots (e.g. he forgot to tick \"combine lots\" when he sent them). Turns combineLots on for the given drafts — waiting for Claude, or written and still in Review — and puts them in one new batch, so listing_combine_lot and listing_pool_add work on them. Nothing is approved or published, and Todd can split a lot again. Never call it on your own initiative.",
      inputSchema: {
        type: "object",
        required: ["draft_ids", "todd_said"],
        properties: {
          draft_ids: { type: "array", items: { type: "string" }, description: "Draft ids from listing_queue / listing_written" },
          todd_said: { type: "string", description: "Todd's words in this chat that allow it (quote him briefly)" },
        },
      },
      run: async (a) => {
        const ids = Array.isArray(a.draft_ids) ? (a.draft_ids as unknown[]).map(String) : [];
        const said = argStr(a, "todd_said", 300);
        if (!said) throw new Error("Quote what Todd said that allows combining these.");
        const r = await allowLotsFromChat(ids, who);
        return { ...r, note: r.allowed ? "Done. Re-read listing_queue: these now show combineLots: true in one batch." : "None of those drafts can be changed (they must be waiting for Claude or in Review, and not already a lot)." };
      },
    },
    {
      name: "listing_add_to_lot",
      title: "Add pieces to an open lot",
      readOnly: false,
      description:
        "For lots Todd is holding open (listing_queue's openLots). Adds drafts from your queue that belong in that lot: their photos go in piece by piece, FIA rebuilds the cover from every piece's front, the added drafts are set aside (Todd can split the lot again), and the lot closes and comes back to your queue — then write it for all its pieces with listing_get_draft + listing_save. Only add pieces that clearly belong (same theme, series, place, maker or correspondence).",
      inputSchema: {
        type: "object",
        required: ["lot_id", "draft_ids", "reason"],
        properties: {
          lot_id: { type: "string", description: "lotId from listing_queue's openLots" },
          draft_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 22, description: "Drafts from your queue to add" },
          reason: { type: "string", description: "One or two sentences: why these belong in this lot (shown to Todd)" },
        },
      },
      run: async (a) => {
        const ids = Array.isArray(a.draft_ids) ? (a.draft_ids as unknown[]).map(String) : [];
        return addToLot(argStr(a, "lot_id", 64) ?? "", ids, `claude:${who}`, { reason: argStr(a, "reason", 600), byClaude: true });
      },
    },
    {
      name: "listing_pool",
      title: "Todd's lot pool",
      description:
        "The lot pool: lots being formed (pieces, estimated values, Todd's suggested price) and pieces not in a lot yet. 'pooled' pieces are set aside in bin LOTPOOL; 'candidate' pieces are still listed on their own (stale inventory). Text only — cheap to read before deciding lots.",
      inputSchema: { type: "object", properties: {} },
      run: async () => claudePool(),
    },
    {
      name: "listing_pool_add",
      title: "Set a piece aside in the lot pool",
      readOnly: false,
      description:
        "For a queued draft with combineLots: true that would sell better in a lot but has no partner in this batch. Identify it and estimate its value — don't write a listing. Put it into an EXISTING forming lot (group_id from listing_pool) whenever one reasonably fits; start a new one (new_lot_name, with a reason) only when none does, and name it broadly (a theme, not one city or state). Postcards only go with postcards unless the lot allows mixing. The reply says when the lot becomes ready to list.",
      inputSchema: {
        type: "object",
        required: ["draft_id", "identification", "est_value_usd"],
        properties: {
          draft_id: { type: "string" },
          identification: { type: "string", description: "What it is, in a line (maker, place, era)" },
          est_value_usd: { type: "number", description: "What it would sell for on its own" },
          is_postcard: { type: "boolean" },
          group_id: { type: "string" },
          new_lot_name: { type: "string", description: "Broad theme, e.g. 'Linen view postcards, US' or 'St. Louis souvenir brochures'" },
          reason: { type: "string", description: "Required with new_lot_name: why these would sell as a lot" },
          note: { type: "string" },
        },
      },
      run: async (a) => claudePoolAdd(argStr(a, "draft_id", 40) ?? "", a, who),
    },
    {
      name: "listing_pool_group",
      title: "Group lot pool pieces",
      readOnly: false,
      description:
        "Put pool pieces (member ids from listing_pool) into a forming lot (group_id) or a new one (new_lot_name), with a short reason and a suggested lot price. Also use it to merge lots that belong together (move every piece of one into the other; the empty one stops showing). Todd lists lots when he's ready.",
      inputSchema: {
        type: "object",
        required: ["member_ids"],
        properties: {
          member_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 },
          group_id: { type: "string" },
          new_lot_name: { type: "string" },
          reason: { type: "string" },
          suggested_price: { type: "number" },
        },
      },
      run: async (a) => claudePoolGroup(a, who),
    },
    {
      name: "listing_written",
      title: "Drafts Claude wrote (in Review)",
      description:
        "Drafts you wrote that are still waiting in Todd's Review queue (not approved yet), newest first, with their flags. You can change any of them with listing_revise until Todd approves it.",
      inputSchema: { type: "object", properties: { limit: { type: "number", default: 30 } } },
      run: async (a) => claudeWritten(Math.max(1, Math.min(50, Number(a.limit) || 30))),
    },
    {
      name: "listing_revise",
      title: "Revise a listing you wrote",
      readOnly: false,
      description:
        "Change a draft you already saved that is still in Review — or any written draft Todd asked you to fix (listing_fixes) — e.g. trim words from a description, fix a title, change the price, condition, category, shelves or specifics. Send only the fields that change; everything else — including any edits Todd made by hand — stays. The same rules run again (cleanup, .87 prices, specifics fitted to the category). Use listing_get_draft first to see the current text.",
      inputSchema: { type: "object", required: ["draft_id"], properties: {} as Record<string, unknown> },
      run: async (a) => {
        const id = argStr(a, "draft_id", 40) ?? "";
        const { draft_id: _drop, ...changes } = a;
        void _drop;
        if (!Object.keys(changes).length) throw new Error("Send at least one field to change.");
        return reviseClaudeWrite(id, changes, who);
      },
    },
    {
      name: "listing_fixes",
      title: "Todd's fix requests",
      description:
        "Drafts Todd asked you to fix after you wrote them (before he approves). Each request has his note and the drafts it's for (one note can cover a batch). Work these before new drafts: listing_get_draft, change only what he asked (listing_revise, listing_fix_photos, listing_fix_details), then listing_fix_done with a one-line summary.",
      inputSchema: { type: "object", properties: {} },
      run: async () => ({ requests: await fixQueue() }),
    },
    {
      name: "listing_fix_photos",
      title: "Fix a draft's photos",
      readOnly: false,
      description:
        "For a draft Todd asked you to fix: reorder its photos (order = current photo positions in the order you want; any left out keep their order after them), turn photos (rotate: [{position, turn: 90 clockwise | -90 | 180}]), or take photos off (remove: positions). Turns and removals use the positions as they are BEFORE the reorder. Photos end up numbered 1…n.",
      inputSchema: {
        type: "object",
        required: ["draft_id"],
        properties: {
          draft_id: { type: "string" },
          order: { type: "array", items: { type: "number" } },
          rotate: { type: "array", items: { type: "object", properties: { position: { type: "number" }, turn: { type: "number" } } } },
          remove: { type: "array", items: { type: "number" } },
        },
      },
      run: async (a) =>
        fixPhotos(argStr(a, "draft_id", 40) ?? "", {
          order: Array.isArray(a.order) ? (a.order as unknown[]).map(Number) : undefined,
          rotate: Array.isArray(a.rotate) ? (a.rotate as Array<{ position: number; turn: number }>) : undefined,
          remove: Array.isArray(a.remove) ? (a.remove as unknown[]).map(Number) : undefined,
        }),
    },
    {
      name: "listing_fix_details",
      title: "Fix a draft's bin, quantity, weight or shipping",
      readOnly: false,
      description:
        "For a draft Todd asked you to fix: change the bin/SKU, quantity, package weight (ounces) or eBay shipping profile name. Send only what changes.",
      inputSchema: {
        type: "object",
        required: ["draft_id"],
        properties: {
          draft_id: { type: "string" },
          bin_sku: { type: "string" },
          quantity: { type: "number" },
          weight_oz: { type: "number" },
          shipping_profile: { type: "string" },
        },
      },
      run: async (a) => {
        const id = argStr(a, "draft_id", 40) ?? "";
        if (!(await hasOpenFix(id))) throw new Error("Only for a draft Todd asked you to fix (see listing_fixes).");
        const edit: Record<string, unknown> = {};
        if (typeof a.bin_sku === "string") edit.binSku = a.bin_sku.trim().slice(0, 60) || null;
        if (a.quantity != null) edit.quantity = Math.max(1, Math.min(999, Math.round(Number(a.quantity)) || 1));
        if (a.weight_oz != null) edit.weightOz = Math.max(0.1, Math.min(2000, Number(a.weight_oz) || 0)) || null;
        if (typeof a.shipping_profile === "string") edit.shippingProfile = a.shipping_profile.trim().slice(0, 120) || null;
        if (!Object.keys(edit).length) throw new Error("Send at least one of bin_sku, quantity, weight_oz, shipping_profile.");
        const r = await updateDraft(id, edit);
        if (!r.ok) throw new Error(r.error ?? "Not saved");
        return { ok: true, changed: Object.keys(edit) };
      },
    },
    {
      name: "listing_fix_done",
      title: "Finish a fix request",
      readOnly: false,
      description:
        "Finish Todd's fix request(s) on one draft with a one-line summary of what you changed (or why it didn't apply to this draft). The draft stays in Review; Todd sees a before/after and can accept or undo.",
      inputSchema: {
        type: "object",
        required: ["draft_id", "summary"],
        properties: { draft_id: { type: "string" }, summary: { type: "string" } },
      },
      run: async (a) => {
        const n = await completeFixes(argStr(a, "draft_id", 40) ?? "", argStr(a, "summary", 1000) ?? "", `claude:${who}`);
        return { ok: true, finished: n, note: "Done — it's back in Todd's Review queue with your summary." };
      },
    },
    {
      name: "listing_save",
      title: "Save the written listing",
      readOnly: false,
      description:
        "Save the listing you wrote for a queued draft (first save only; to change it afterwards use listing_revise). FIA cleans the title/description, applies the price rules (.87 endings, floors, Poshmark floor), keeps only item specifics that are real fields for the category, sets weight and shipping profile, and moves the draft to Todd's Review queue. Returns what was saved and any flags. Nothing is approved or published.",
      inputSchema: {
        type: "object",
        required: ["draft_id", "title", "description", "condition", "price"],
        properties: {
          draft_id: { type: "string" },
          title: { type: "string", description: "≤ 80 characters; aim for 70–80" },
          description: { type: "string", description: "Plain text, ≤ 1,400 characters; first paragraph says what it is + a condition sentence" },
          condition: { type: "string", enum: CONDITIONS },
          condition_note: {
            type: "string",
            description:
              "For a single trading card, start with \"Ungraded.\" or the slab's grader, grade and cert (\"PSA 9, cert 12345678.\"), then the wear. FIA reads this to pick eBay's card condition (ungraded: Near Mint or Better / Excellent / Very Good / Poor — say \"crease\", \"heavy wear\" etc. plainly).",
          },
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
          unverified: {
            type: "array",
            description: "Confident words you used that the item itself doesn't show (rule 1d). They stay in the listing; Todd keeps or removes each in Review.",
            items: { type: "object", properties: { words: { type: "string", description: "Exactly as written in the listing" }, basis: { type: "string" } }, required: ["words"] },
          },
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
