// Write with Claude: a listing draft queued for Claude in the Claude app,
// which writes it through the FIA connector (lib/mcp) instead of FIA's own
// writer calling the AI gateway. Claude reads the draft (photos, intake
// facts, the matched Expert Guides, the supply snapshot, the store's
// categories and shelves), does the identify / write / specifics work
// itself, and saves the result. FIA applies the same rules the automatic
// writer does (title and description cleanup, .87 prices and floors,
// category and shelf checks, item specifics fitted to the eBay category,
// weight and shipping profile), and the draft lands in Review. Nothing is
// approved, sent to Nifty or published from here.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { categoryAspects } from "@/lib/ebay/taxonomy";
import { aspectPromptText, fitSpecifics } from "@/lib/ebay/aspects";
import { buildCategoryOptions } from "@/lib/ebay/auto-categorize";
import { listGuides, loadGuide } from "@/lib/enhance/guides";
import { planWeight } from "./weight";
import {
  categoryOptions,
  factsText,
  matchGuides,
  preparePhotos,
  supplySnapshot,
  supplyText,
  writerSettings,
  WRITE_RULES,
} from "./writer";
import {
  applyPriceRules,
  guidePromptText,
  parseIdentification,
  parseWriteOutput,
  rankCategories,
  rankStoreCategories,
  suggestShipping,
  CONDITIONS,
  type Identification,
} from "./rules";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export const CLAUDE_STATUS = "with_claude";

// ─── the queue (admin side) ──────────────────────────────────────────────────

/** Send drafts to Claude. A note becomes Claude's instructions for them. */
export async function sendToClaude(ids: string[], who: string, note?: string | null): Promise<{ sent: number; skipped: number }> {
  const clean = Array.from(new Set(ids.filter((id) => UUID.test(id)))).slice(0, 200);
  if (!clean.length) return { sent: 0, skipped: 0 };
  const n = (note ?? "").trim().slice(0, 2000) || null;
  const done = await rows(sql`
    UPDATE listing_drafts
    SET status = ${CLAUDE_STATUS},
        review_note = COALESCE(${n}, CASE WHEN status = 'sent_back' THEN review_note END),
        generation_error = NULL, updated_at = now(),
        ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('claudeQueuedAt', now(), 'claudeQueuedBy', ${who}::text)
    WHERE id IN (${sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `)})
      AND status IN ('ready', 'review', 'sent_back')
      AND NOT EXISTS (SELECT 1 FROM draft_photos p WHERE p.draft_id = listing_drafts.id AND p.uploaded_at IS NULL)
    RETURNING id`);
  return { sent: done.length, skipped: clean.length - done.length };
}

/** Take a draft back from Claude's queue (to Ready, or Review if written). */
export async function takeBackFromClaude(id: string): Promise<boolean> {
  const done = await rows(sql`
    UPDATE listing_drafts SET status = CASE WHEN written_by IS NULL THEN 'ready' ELSE 'review' END, updated_at = now()
    WHERE id = ${id} AND status = ${CLAUDE_STATUS} RETURNING id`);
  return done.length > 0;
}

/** Every "ready" draft with all photos uploaded (the "send all ready" button). */
export async function readyDraftIds(limit = 200): Promise<string[]> {
  const found = await rows(sql`
    SELECT id FROM listing_drafts d WHERE d.status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM draft_photos p WHERE p.draft_id = d.id AND p.uploaded_at IS NULL)
    ORDER BY created_at LIMIT ${limit}`);
  return found.map((r) => String(r.id));
}

// ─── what Claude reads (connector side) ─────────────────────────────────────

export async function claudeQueue(limit = 50) {
  const list = await rows(sql`
    SELECT d.id, d.title, d.title_hint, d.source, d.source_label, d.bin_sku, d.review_note, d.created_at,
           (SELECT count(*)::int FROM draft_photos p WHERE p.draft_id = d.id AND p.uploaded_at IS NOT NULL) AS photos
    FROM listing_drafts d WHERE d.status = ${CLAUDE_STATUS}
    ORDER BY d.created_at LIMIT ${limit}`);
  const [c] = await rows(sql`SELECT count(*)::int AS n FROM listing_drafts WHERE status = ${CLAUDE_STATUS}`);
  return {
    waiting: Number(c?.n ?? 0),
    drafts: list.map((r) => ({
      id: String(r.id),
      hint: (r.title as string | null) ?? (r.title_hint as string | null) ?? null,
      from: (r.source_label as string | null) ?? String(r.source),
      bin: (r.bin_sku as string | null) ?? null,
      photos: Number(r.photos ?? 0),
      instructions: (r.review_note as string | null) ?? null,
      added: iso(r.created_at),
    })),
  };
}

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

async function loadQueued(id: string): Promise<Row> {
  if (!UUID.test(id)) throw new Error("draft_id must be an id from listing_queue");
  const [d] = await rows(sql`SELECT * FROM listing_drafts WHERE id = ${id}`);
  if (!d) throw new Error("No such draft");
  if (String(d.status) !== CLAUDE_STATUS)
    throw new Error(`This draft is "${String(d.status).replace("_", " ")}", not waiting for Claude. Todd queues drafts from FIA's Listings page.`);
  return d;
}

function routeText(d: Row, extra?: string | null): string {
  const f = (d.facts ?? {}) as Record<string, unknown>;
  return [d.title_hint, d.title, d.notes, f.sku_class, f.estate_title, extra].filter(Boolean).join(" ");
}

/** Everything Claude needs to write one draft: rules, facts, guides,
 *  pricing context, the store's categories and shelves, and the photos. */
export async function claudeDraftPacket(id: string): Promise<McpContent[]> {
  const d = await loadQueued(id);
  const settings = await writerSettings();
  const photoRows = await rows(sql`
    SELECT position, role, url FROM draft_photos WHERE draft_id = ${id} AND uploaded_at IS NOT NULL
    ORDER BY position LIMIT ${Math.min(settings.maxPhotos, 8)}`);
  if (!photoRows.length) throw new Error("This draft has no uploaded photos yet.");
  const photos = await preparePhotos(
    photoRows.map((p) => ({ position: Number(p.position), role: p.role ? String(p.role) : null, url: String(p.url) })),
    1200
  );
  const rt = routeText(d);
  const [guides, supply, cats, store] = await Promise.all([
    matchGuides(rt),
    supplySnapshot(String(d.title_hint || d.title || "")),
    categoryOptions(),
    buildCategoryOptions().catch(() => []),
  ]);
  const candidates = rankCategories(cats, rt, 50);
  const shelves = rankStoreCategories(
    store.map((o) => ({ id: o.id, path: o.path.replace(/&amp;/g, "&"), isAlabama: o.isAlabama })),
    rt,
    150
  );
  const instructions = (d.review_note as string | null)?.trim();
  const text = [
    `DRAFT ${id}${d.bin_sku ? ` · bin ${d.bin_sku} (never put the bin in the listing)` : ""} · from ${d.source_label ?? d.source}`,
    instructions ? `TODD'S INSTRUCTIONS FOR THIS ONE (true; they override everything): ${instructions}` : "",
    `INTAKE FACTS:\n${factsText(d)}`,
    `Photos below: ${photos.labels.join(", ")}.${photos.skipped.length ? ` (Couldn't load: ${photos.skipped.join("; ")})` : ""}`,
    guides.length
      ? guidePromptText(guides.map((g) => ({ id: g.id, name: g.name, content: g.content })), 24_000, 14_000)
      : "No Expert Guide matched the intake words. Once you know what the item is, call listing_find_guide with a few words (e.g. 'rppc postcard', 'vinyl record gospel') and use what it returns; otherwise be conservative on price.",
    supplyText(supply),
    `eBay categories this store uses (id — path), best guesses from the intake words; call listing_find_categories for others:\n${candidates.map((c) => `${c.id} — ${c.path}`).join("\n")}`,
    shelves.length ? `The store's own shelves (store_category_ids; id — path, [AL] = Alabama):\n${shelves.map((c) => `${c.id} — ${c.isAlabama ? "[AL] " : ""}${c.path}`).join("\n")}` : "",
    `WRITING RULES (the same ones FIA's own writer follows):\n${WRITE_RULES}`,
    `HOW TO FINISH: pick the eBay category, call listing_category_specifics with its id to see the real item-specific fields, then call listing_save with the listing fields from the JSON above plus "identification" (kind, card_type, era, places, est_value_usd, notes). FIA applies the price rules (.87 endings, floors, Poshmark floor), title/description cleanup and weight/shipping, and puts the draft in Todd's Review queue. Mention anything uncertain in "flags".`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { type: "text", text },
    ...photos.parts.map((p): McpContent => {
      const url = (p as { image_url?: { url?: string } }).image_url?.url ?? "";
      const m = url.match(/^data:([^;]+);base64,(.*)$/);
      return m ? { type: "image", mimeType: m[1], data: m[2] } : { type: "text", text: "(photo missing)" };
    }),
  ];
}

export async function claudeFindCategories(query: string) {
  const q = query.trim().slice(0, 120);
  if (!q) throw new Error("Give a few words, e.g. 'postcard alabama' or 'vinyl gospel'");
  const cats = await categoryOptions();
  return { categories: rankCategories(cats, q, 30).map((c) => ({ id: c.id, path: c.path, listingsInStore: c.count })) };
}

export async function claudeFindGuide(query: string) {
  const q = query.trim().slice(0, 200);
  if (!q) {
    const all = (await listGuides()).filter((g) => g.stage !== "buy");
    return { guides: all.map((g) => ({ id: g.id, name: g.name, family: g.family, description: g.description })) };
  }
  const found = await matchGuides(q);
  if (!found.length) return { note: "No guide matched those words. Call again with no words to see the full list, then ask for one by id." };
  return { guides: found.map((g) => ({ id: g.id, name: g.name, content: g.content.slice(0, 16_000) })) };
}

export async function claudeGuideById(id: string) {
  const g = await loadGuide(id);
  if (!g) throw new Error("No guide with that id");
  return { id: g.id, name: g.name, content: g.content.slice(0, 20_000) };
}

export async function claudeCategorySpecifics(categoryId: string) {
  const id = categoryId.replace(/\D/g, "");
  const aspects = id ? await categoryAspects(id) : null;
  if (!aspects || !aspects.length) return { categoryId: id, note: "No item-specific list for that category; use the guide's map and common sense." };
  return { categoryId: id, fields: aspectPromptText(aspects, 20, 40) };
}

// ─── saving Claude's listing ─────────────────────────────────────────────────

export type ClaudeWrite = Record<string, unknown>;

export async function saveClaudeWrite(id: string, input: ClaudeWrite, who: string) {
  const d = await loadQueued(id);
  const settings = await writerSettings();
  const cats = await categoryOptions();
  const store = await buildCategoryOptions().catch(() => []);
  const catIds = new Set(cats.map((c) => c.id));
  const storeIds = new Set(store.map((o) => o.id));

  const parsed = parseWriteOutput(JSON.stringify(input), {
    binSku: d.bin_sku as string | null,
    categoryIds: catIds,
    storeCategoryIds: storeIds,
  });
  if (!parsed.ok) throw new Error(`${parsed.error.replace("The model's reply", "The listing")}. Send title, description, condition (${CONDITIONS.join(" / ")}), price and the rest as fields.`);
  const out = parsed.value;
  const ident: Identification | null = input.identification ? parseIdentification(JSON.stringify(input.identification)) : null;

  const cat = cats.find((c) => c.id === out.ebayCategoryId) ?? null;
  const isPostcard = ident?.kind === "postcard" || /postcard/i.test(cat?.path ?? "");
  const priced =
    out.price != null
      ? applyPriceRules({ suggested: out.price, cardType: ident?.cardType ?? "nonpostcard", isPostcard, floor: settings.floor, poshmarkFloor: settings.poshmarkFloor })
      : null;

  const flags: string[] = [...out.flags];
  let specifics = out.itemSpecifics;
  const aspects = cat ? await categoryAspects(cat.id) : null;
  if (aspects && aspects.length) {
    const fit = fitSpecifics(out.itemSpecifics, aspects);
    specifics = fit.kept;
    if (fit.dropped.length) flags.push(`Dropped item specifics that aren't fields in this category: ${fit.dropped.join(", ")}`);
    if (fit.missingRequired.length) flags.push(`eBay requires: ${fit.missingRequired.join(", ")} — still empty`);
  }
  if (!cat) flags.push("No eBay category from the store's list — pick one before approving");

  const facts = (d.facts ?? {}) as Record<string, unknown>;
  const weight = planWeight({
    givenOz: d.weight_oz != null ? Number(d.weight_oz) : null,
    kind: ident?.kind ?? null,
    title: out.title,
    identification: ident?.identification ?? null,
    sizeInches: (facts.size_inches as string | null) ?? null,
    source: String(d.source ?? ""),
  });
  const suggested = priced
    ? suggestShipping({ price: priced.price, categoryPath: cat?.path ?? out.ebayCategorySuggestion, kind: ident?.kind ?? "other", weightOz: weight.oz })
    : null;
  const ship =
    weight.source === "assumed" && weight.profile === "media"
      ? { profile: "media" as const, reason: weight.reason }
      : weight.source === "assumed" && weight.profile === "envelope" && suggested?.profile !== "calculated"
        ? { profile: "envelope" as const, reason: weight.reason }
        : suggested;
  if (weight.source === "none") flags.push("No weight: not paper, so nothing was assumed — weigh it (Nifty would keep its template's weight).");

  const prevMeta = (d.ai_meta ?? {}) as Record<string, unknown>;
  const guidesUsed = Array.isArray(input.guides_used) ? (input.guides_used as unknown[]).map(String).slice(0, 5) : [];
  const aiMeta = {
    ...prevMeta,
    tier: "claude",
    tierReason: "written by Claude in the Claude app (FIA connector)",
    model: "claude-app",
    resolvedModel: "claude-app",
    attempts: [],
    identification: ident,
    guides: guidesUsed.map((g) => ({ id: g, name: g, version: null })),
    confidence: out.confidence,
    flags,
    aspectsChecked: !!(aspects && aspects.length),
    priceSuggested: out.price,
    priceLow: out.priceLow,
    priceHigh: out.priceHigh,
    priceRationale: out.priceRationale,
    priceNotes: priced?.notes ?? [],
    shippingReason: ship?.reason ?? null,
    categorySuggestion: cat ? null : out.ebayCategorySuggestion || null,
    corrections: (d.review_note as string | null) ?? null,
    research: prevMeta.research ?? null,
    weight,
    costUsd: 0,
    writtenAt: new Date().toISOString(),
    writtenVia: "claude-connector",
    writtenByConnection: who,
  };

  const saved = await rows(sql`
    UPDATE listing_drafts SET
      title = ${out.title},
      description = ${out.description},
      condition = ${out.condition},
      condition_note = ${out.conditionNote || null},
      ebay_category_id = ${cat?.id ?? null},
      ebay_category_name = ${cat?.path ?? (out.ebayCategorySuggestion || null)},
      item_specifics = ${Object.keys(specifics).length ? JSON.stringify(specifics) : null}::jsonb,
      price = ${priced?.price ?? null},
      venue_prices = ${priced?.venuePrices ? JSON.stringify(priced.venuePrices) : null}::jsonb,
      shipping_profile = ${ship?.profile ?? null},
      store_category_ids = ${out.storeCategoryIds.length ? JSON.stringify(out.storeCategoryIds) : null}::jsonb,
      ai_meta = ${JSON.stringify(aiMeta)}::jsonb,
      written_by = 'claude',
      review_note = NULL,
      status = 'review',
      generation_error = NULL,
      updated_at = now()
    WHERE id = ${id} AND status = ${CLAUDE_STATUS}
    RETURNING id`);
  if (!saved.length) throw new Error("The draft changed while you were writing it (Todd may have taken it back); nothing was saved.");
  if (d.registry_item_id) {
    await db.execute(sql`
      UPDATE registry_items SET title = ${out.title},
        title_normalized = lower(regexp_replace(trim(${out.title}), '\\s+', ' ', 'g')), updated_at = now()
      WHERE id = ${String(d.registry_item_id)} AND status = 'draft'`);
  }
  const [left] = await rows(sql`SELECT count(*)::int AS n FROM listing_drafts WHERE status = ${CLAUDE_STATUS}`);
  return {
    saved: true,
    draftId: id,
    title: out.title,
    price: priced?.price ?? null,
    poshmarkPrice: priced?.venuePrices ? (priced.venuePrices as Record<string, number>).poshmark ?? null : null,
    category: cat?.path ?? null,
    shipping: ship?.profile ?? null,
    weightOz: weight.oz,
    flags,
    reviewUrl: `https://www.foundinalabama.com/admin/listings/${id}`,
    stillWaiting: Number(left?.n ?? 0),
  };
}

