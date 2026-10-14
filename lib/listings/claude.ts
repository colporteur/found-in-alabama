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

/** Send drafts to Claude. A note becomes Claude's instructions for them.
 *  Everything sent in one go is one batch; with `lots` on, Claude may
 *  combine drafts of that batch into lots (lib/listings/lots.ts). */
export async function sendToClaude(
  ids: string[],
  who: string,
  note?: string | null,
  lots = false
): Promise<{ sent: number; skipped: number }> {
  const clean = Array.from(new Set(ids.filter((id) => UUID.test(id)))).slice(0, 200);
  if (!clean.length) return { sent: 0, skipped: 0 };
  const n = (note ?? "").trim().slice(0, 2000) || null;
  const batch = `${new Date().toISOString().slice(0, 16)}-${Math.random().toString(36).slice(2, 7)}`;
  const done = await rows(sql`
    UPDATE listing_drafts
    SET status = ${CLAUDE_STATUS},
        review_note = COALESCE(${n}, CASE WHEN status = 'sent_back' THEN review_note END),
        generation_error = NULL, updated_at = now(),
        ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('claudeQueuedAt', now(), 'claudeQueuedBy', ${who}::text,
                                                                     'claudeBatch', ${batch}::text, 'claudeLots', ${lots}::boolean)
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
           d.ai_meta->>'claudeBatch' AS batch, (d.ai_meta->>'claudeLots')::boolean AS lots,
           jsonb_array_length(COALESCE(d.ai_meta->'lot'->'parts', '[]'::jsonb)) AS lot_parts,
           (SELECT count(*)::int FROM draft_photos p WHERE p.draft_id = d.id AND p.uploaded_at IS NOT NULL) AS photos
    FROM listing_drafts d WHERE d.status = ${CLAUDE_STATUS}
    ORDER BY d.created_at LIMIT ${limit}`);
  const [c] = await rows(sql`SELECT count(*)::int AS n FROM listing_drafts WHERE status = ${CLAUDE_STATUS}`);
  const anyLots = list.some((r) => r.lots === true && !Number(r.lot_parts));
  return {
    waiting: Number(c?.n ?? 0),
    ...(anyLots
      ? {
          lots:
            "Some drafts have combineLots: true. Before writing those, look over their batch (same batch value; open them with listing_get_draft) and combine pieces into a lot with listing_combine_lot when price and shared affinity make market sense — e.g. low-value pieces that sell better together (same city, theme, maker, series). Leave anything that sells well on its own as its own listing. FIRST read Todd's lot pool (listing_pool) — pieces from earlier batches waiting for partners. When a lot you're forming in this batch fits pieces waiting there, include them: listing_combine_lot with draft_ids (from this batch) plus pool_member_ids. A piece that would sell better in a lot but has no partner yet goes into the pool with listing_pool_add (identify + estimate value; no listing) — into an EXISTING pool lot whenever one reasonably fits; start a new lot only when none does, name it broadly (e.g. 'Linen view postcards, US', not one lot per state) and give a reason. Postcards only lot with postcards unless the lot allows mixing. When a pool lot is marked ready, tell Todd in your reply (he lists it from FIA's Lot pool page). Then write each lot (and each remaining draft) as usual.",
        }
      : {}),
    drafts: list.map((r) => ({
      id: String(r.id),
      hint: (r.title as string | null) ?? (r.title_hint as string | null) ?? null,
      from: (r.source_label as string | null) ?? String(r.source),
      bin: (r.bin_sku as string | null) ?? null,
      photos: Number(r.photos ?? 0),
      instructions: (r.review_note as string | null) ?? null,
      added: iso(r.created_at),
      batch: (r.batch as string | null) ?? null,
      ...(r.lots === true && !Number(r.lot_parts) ? { combineLots: true } : {}),
      ...(Number(r.lot_parts) ? { lotOf: Number(r.lot_parts) } : {}),
    })),
  };
}

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** Claude may work on a draft Todd queued, or revise one it wrote that is
 *  still waiting in Review (not approved, not sent anywhere). */
const REVISABLE = ["review", "sent_back"];
const claudeWrote = (d: Row) => /^claude/.test(String(d.written_by ?? ""));

async function loadQueued(id: string, allowRevise = false): Promise<Row> {
  if (!UUID.test(id)) throw new Error("draft_id must be an id from listing_queue or listing_written");
  const [d] = await rows(sql`SELECT * FROM listing_drafts WHERE id = ${id}`);
  if (!d) throw new Error("No such draft");
  const st = String(d.status);
  if (st === CLAUDE_STATUS) return d;
  if (allowRevise && REVISABLE.includes(st) && claudeWrote(d)) return d;
  if (!allowRevise && REVISABLE.includes(st) && claudeWrote(d))
    throw new Error("You already saved this one; change it with listing_revise (send only the fields that change).");
  if (allowRevise && REVISABLE.includes(st))
    throw new Error("FIA's automatic writer (or Todd) wrote this one, so Claude can't change it. Todd can send it to Claude from its page.");
  throw new Error(
    `This draft is "${st.replace("_", " ")}". Claude can write drafts waiting for Claude, and revise its own drafts until Todd approves them.`
  );
}

function routeText(d: Row, extra?: string | null): string {
  const f = (d.facts ?? {}) as Record<string, unknown>;
  return [d.title_hint, d.title, d.notes, f.sku_class, f.estate_title, extra].filter(Boolean).join(" ");
}

/** Everything Claude needs to write one draft: rules, facts, guides,
 *  pricing context, the store's categories and shelves, and the photos. */
export async function claudeDraftPacket(id: string): Promise<McpContent[]> {
  const d = await loadQueued(id, true);
  const settings = await writerSettings();
  const first = (d.ai_meta as Record<string, unknown> | null)?.lot ? 12 : Math.min(settings.maxPhotos, 8);
  const photoRows = await rows(sql`
    SELECT position, role, url FROM draft_photos WHERE draft_id = ${id} AND uploaded_at IS NOT NULL
    ORDER BY position LIMIT ${first}`);
  const [pc] = await rows(sql`SELECT count(*)::int AS n FROM draft_photos WHERE draft_id = ${id} AND uploaded_at IS NOT NULL`);
  const totalPhotos = Number(pc?.n ?? photoRows.length);
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
  const meta = (d.ai_meta ?? {}) as Record<string, unknown>;
  const lot = meta.lot as { parts?: Array<{ title: string | null; bin: string | null }> } | undefined;
  const lotText = lot?.parts?.length
    ? `THIS IS A LOT of ${lot.parts.length} pieces you combined: ${lot.parts.map((p, i) => `${i + 1}) ${p.title ?? "item"}`).join("; ")}. ` +
      `Photo 1 is the cover (each piece's front); then each piece's front, then backs/insides. Write ONE listing for the whole lot: ` +
      `the title starts "Lot of ${lot.parts.length}" (or names the set), the description covers each piece in turn with its own condition, ` +
      `item specifics fit the lot as a whole, and the price is for the lot. Quantity stays 1. Never mention bins.`
    : meta.claudeLots === true && String(d.status) === CLAUDE_STATUS
      ? `COMBINE LOTS IS ON for this batch (${String(meta.claudeBatch ?? "")}): if this piece and others in the same batch sell better together (price and shared affinity make market sense), combine them with listing_combine_lot before writing; otherwise write it on its own.`
      : "";
  const current =
    String(d.status) !== CLAUDE_STATUS && d.title
      ? [
          `CURRENT LISTING (you wrote it; it's in Todd's Review queue${String(d.written_by).includes("hand") ? ", and Todd has edited it by hand — keep his edits" : ""}). Change only what needs changing with listing_revise:`,
          `title: ${d.title}`,
          `price: ${d.price ?? "—"} · condition: ${d.condition ?? "—"}${d.condition_note ? ` (${d.condition_note})` : ""}`,
          `eBay category: ${d.ebay_category_id ?? "—"} ${d.ebay_category_name ?? ""} · shelves: ${JSON.stringify(d.store_category_ids ?? [])}`,
          `item specifics: ${JSON.stringify(d.item_specifics ?? {})}`,
          `description:\n${d.description ?? ""}`,
        ].join("\n")
      : "";
  const text = [
    `DRAFT ${id}${d.bin_sku ? ` · bin ${d.bin_sku} (never put the bin in the listing)` : ""} · from ${d.source_label ?? d.source}`,
    current,
    lotText,
    instructions ? `TODD'S INSTRUCTIONS FOR THIS ONE (true; they override everything): ${instructions}` : "",
    `INTAKE FACTS:\n${factsText(d)}`,
    `Photos below: ${photos.labels.join(", ")}.${photos.skipped.length ? ` (Couldn't load: ${photos.skipped.join("; ")})` : ""}` +
      (totalPhotos > photoRows.length
        ? ` This draft has ${totalPhotos} photos; you're seeing the first ${photoRows.length}. If the rest could change what you write (more pages, a back, a postmark, a maker's mark, another piece of a lot), call listing_get_photos with from=${photoRows.length + 1}; skip it when these are enough.`
        : ""),
    guides.length
      ? guidePromptText(guides.map((g) => ({ id: g.id, name: g.name, content: g.content })), 24_000, 14_000)
      : "No Expert Guide matched the intake words. Once you know what the item is, call listing_find_guide with a few words (e.g. 'rppc postcard', 'vinyl record gospel') and use what it returns; otherwise be conservative on price.",
    supplyText(supply),
    `eBay categories this store uses (id — path), best guesses from the intake words; call listing_find_categories for others:\n${candidates.map((c) => `${c.id} — ${c.path}`).join("\n")}`,
    shelves.length ? `The store's own shelves (store_category_ids; id — path, [AL] = Alabama):\n${shelves.map((c) => `${c.id} — ${c.isAlabama ? "[AL] " : ""}${c.path}`).join("\n")}` : "",
    `WRITING RULES (the same ones FIA's own writer follows):\n${WRITE_RULES}`,
    `HOW TO FINISH: pick the eBay category, call listing_category_specifics with its id to see the real item-specific fields, then call listing_save with the listing fields from the JSON above plus "identification" (kind, card_type, era, places, est_value_usd, notes). Confident words the item doesn't show (rule 1d) stay in the listing and go in "unverified" — Todd keeps or removes each with one click in Review, so don't take them out yourself. FIA applies the price rules (.87 endings, floors, Poshmark floor), title/description cleanup and weight/shipping, and puts the draft in Todd's Review queue. Mention anything uncertain in "flags".`,
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

/** More of a draft's photos, a few at a time (listing_get_photos), for
 *  drafts with more photos than listing_get_draft sends. */
export async function claudeMorePhotos(id: string, from: number, count: number): Promise<McpContent[]> {
  await loadQueued(id, true);
  const start = Math.max(1, Math.floor(from) || 1);
  const n = Math.max(1, Math.min(6, Math.floor(count) || 6));
  const all = await rows(sql`
    SELECT position, role, url FROM draft_photos WHERE draft_id = ${id} AND uploaded_at IS NOT NULL ORDER BY position`);
  const slice = all.slice(start - 1, start - 1 + n);
  if (!slice.length) return [{ type: "text", text: `This draft has ${all.length} photos; there's nothing from photo ${start} on.` }];
  const photos = await preparePhotos(
    slice.map((p) => ({ position: Number(p.position), role: p.role ? String(p.role) : null, url: String(p.url) })),
    1200
  );
  const end = start + slice.length - 1;
  const labels = photos.labels.map((l, i) => l.replace(/^Photo \d+/, `Photo ${start + i}`));
  return [
    {
      type: "text",
      text:
        `Photos ${start}–${end} of ${all.length}: ${labels.join(", ")}.` +
        (photos.skipped.length ? ` (Couldn't load: ${photos.skipped.join("; ")})` : "") +
        (end < all.length ? ` More with from=${end + 1}.` : " That's all of them."),
    },
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

/** Drafts Claude wrote that are still waiting for Todd's review. */
export async function claudeWritten(limit = 50) {
  const list = await rows(sql`
    SELECT id, title, price, status, written_by, updated_at, ai_meta->'flags' AS flags
    FROM listing_drafts WHERE status IN ('review', 'sent_back') AND written_by LIKE 'claude%'
    ORDER BY updated_at DESC LIMIT ${limit}`);
  return {
    drafts: list.map((r) => ({
      id: String(r.id),
      title: (r.title as string | null) ?? null,
      price: r.price == null ? null : Number(r.price),
      status: String(r.status),
      editedByTodd: String(r.written_by).includes("hand"),
      flags: Array.isArray(r.flags) ? r.flags : [],
      updated: iso(r.updated_at),
    })),
  };
}

/** Revise a draft Claude wrote (still in Review): only the fields given
 *  change; everything else, including Todd's hand edits, stays. */
export async function reviseClaudeWrite(id: string, changes: ClaudeWrite, who: string) {
  const d = await loadQueued(id, true);
  if (String(d.status) === CLAUDE_STATUS) throw new Error("This draft hasn't been written yet — use listing_save for it.");
  const meta = (d.ai_meta ?? {}) as Record<string, unknown>;
  const current: ClaudeWrite = {
    title: d.title,
    description: d.description,
    condition: d.condition,
    condition_note: d.condition_note ?? "",
    ebay_category_id: d.ebay_category_id ?? "",
    ebay_category_suggestion: meta.categorySuggestion ?? "",
    store_category_ids: Array.isArray(d.store_category_ids) ? d.store_category_ids : [],
    item_specifics: d.item_specifics ?? {},
    price: d.price == null ? null : Number(d.price),
    price_low: meta.priceLow ?? null,
    price_high: meta.priceHigh ?? null,
    price_rationale: meta.priceRationale ?? "",
    confidence: meta.confidence ?? null,
    flags: [],
    guides_used: Array.isArray(meta.guides) ? (meta.guides as Array<{ id?: string }>).map((g) => g.id).filter(Boolean) : [],
    unverified: Array.isArray(meta.unverified)
      ? (meta.unverified as Array<{ words: string; basis: string; decision?: string | null }>).filter((u) => u.decision !== "removed")
      : [],
  };
  const merged: ClaudeWrite = { ...current };
  for (const [k, v] of Object.entries(changes)) if (v !== undefined) merged[k] = v;
  const r = await saveClaudeWrite(id, merged, who, { revise: true, keepIdent: (meta.identification as Identification | null) ?? null });
  return { ...r, changed: Object.keys(changes).filter((k) => changes[k] !== undefined) };
}

export async function saveClaudeWrite(
  id: string,
  input: ClaudeWrite,
  who: string,
  opts: { revise?: boolean; keepIdent?: Identification | null } = {}
) {
  const d = await loadQueued(id, !!opts.revise);
  if (!opts.revise && String(d.status) !== CLAUDE_STATUS) throw new Error("Already written — use listing_revise to change it.");
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
  const ident: Identification | null = input.identification
    ? parseIdentification(JSON.stringify(input.identification))
    : opts.keepIdent ?? null;

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
  const lotParts = ((prevMeta.lot as { parts?: unknown[] } | undefined)?.parts ?? []).length;
  if (lotParts && !opts.revise) flags.unshift(`Lot: Claude combined ${lotParts} drafts into this one — check the pieces, the cover and the price.`);
  const guidesUsed = Array.isArray(input.guides_used) ? (input.guides_used as unknown[]).map(String).slice(0, 5) : [];
  const aiMeta = {
    ...prevMeta,
    revisedAt: opts.revise ? new Date().toISOString() : (prevMeta.revisedAt ?? null),
    tier: "claude",
    tierReason: "written by Claude in the Claude app (FIA connector)",
    model: "claude-app",
    resolvedModel: "claude-app",
    attempts: [],
    identification: ident,
    guides: guidesUsed.map((g) => ({ id: g, name: g, version: null })),
    confidence: out.confidence,
    flags,
    // Todd's earlier keep/remove decisions survive a revision for the same words.
    unverified: out.unverified.map((u) => ({
      ...u,
      decision:
        ((prevMeta.unverified as Array<{ words: string; decision?: string | null }> | undefined) ?? []).find(
          (p) => p.words.toLowerCase() === u.words.toLowerCase()
        )?.decision ?? null,
    })),
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
      written_by = CASE WHEN written_by LIKE '%hand%' THEN 'claude+hand' ELSE 'claude' END,
      review_note = CASE WHEN status IN (${CLAUDE_STATUS}, 'sent_back') THEN NULL ELSE review_note END,
      status = CASE WHEN status IN (${CLAUDE_STATUS}, 'sent_back') THEN 'review' ELSE status END,
      generation_error = NULL,
      updated_at = now()
    WHERE id = ${id} AND status = ${String(d.status)}
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


// ─── the lot pool, for Claude (lib/listings/pool.ts) ────────────────────────

export async function claudePool() {
  const { loadPool } = await import("./pool");
  const p = await loadPool();
  const m = (x: Awaited<ReturnType<typeof loadPool>>["loose"][number]) => ({
    memberId: x.id,
    kind: x.kind === "candidate" ? "candidate (still listed on its own)" : "pooled",
    title: x.title,
    identification: x.identification,
    postcard: x.isPostcard,
    estValue: x.estValue,
    waitingDays: x.days,
  });
  const { READY_RULE } = await import("./pool");
  return {
    note:
      "Lot pool: pieces waiting to become lots. Join pieces to existing lots when they reasonably fit; keep lot themes broad. " +
      `A lot is 'ready' at ${READY_RULE} — mention ready lots to Todd; he lists them from the Lot pool page. ` +
      "Pooled pieces (not candidates) can also join a lot you form in the current batch: listing_combine_lot with pool_member_ids. " +
      "Lots that should be one (e.g. three single-state linen view lots) can be merged with listing_pool_group. Postcards only go with postcards unless allowMix.",
    lots: p.groups.map((g) => ({
      groupId: g.id,
      ready: g.ready,
      name: g.name,
      allowMix: g.allowMix,
      suggestedPrice: g.suggestedPrice,
      reason: g.reason,
      estTotal: g.estTotal,
      pieces: g.members.map(m),
    })),
    notInALotYet: p.loose.map(m),
  };
}

/** Claude parks a queued piece in the pool (identified, valued, not written). */
export async function claudePoolAdd(id: string, a: Record<string, unknown>, who: string) {
  const d = await loadQueued(id, false);
  if (((d.ai_meta ?? {}) as Record<string, unknown>).claudeLots !== true)
    throw new Error("Todd didn't turn on lots for this draft; write it on its own.");
  const { poolDraft } = await import("./pool");
  const str = (k: string, max: number) => (typeof a[k] === "string" ? String(a[k]).trim().slice(0, max) || null : null);
  const est = Number(a.est_value_usd);
  const r = await poolDraft(id, `claude:${who}`, {
    identification: str("identification", 400),
    estValue: Number.isFinite(est) && est > 0 ? Math.round(est * 100) / 100 : null,
    isPostcard: typeof a.is_postcard === "boolean" ? a.is_postcard : null,
    note: str("note", 600),
    groupId: str("group_id", 40),
    newGroup: str("new_lot_name", 120),
  });
  const { updateGroup, loadPool } = await import("./pool");
  if (str("new_lot_name", 120) && r.groupId) await updateGroup(r.groupId, { reason: str("reason", 600) });
  const lot = r.groupId ? (await loadPool()).groups.find((g) => g.id === r.groupId) : null;
  return {
    pooled: true,
    ...r,
    lot: lot ? { name: lot.name, pieces: lot.members.length, estTotal: lot.estTotal, ready: lot.ready } : null,
    note:
      "Set aside in the lot pool (bin LOTPOOL). Todd lists the lot from FIA when it's ready." +
      (lot?.ready ? ` The lot "${lot.name}" is now ready to list — tell Todd.` : ""),
  };
}

/** Claude groups pool pieces into a forming lot (or a new one). */
export async function claudePoolGroup(a: Record<string, unknown>, who: string) {
  const { assignMembers, updateGroup, loadPool } = await import("./pool");
  const memberIds = Array.isArray(a.member_ids) ? (a.member_ids as unknown[]).map(String) : [];
  const groupId = typeof a.group_id === "string" ? a.group_id : null;
  const newGroup = typeof a.new_lot_name === "string" ? a.new_lot_name : null;
  const r = await assignMembers(memberIds, { groupId, newGroup }, `claude:${who}`);
  const price = Number(a.suggested_price);
  if (r.groupId)
    await updateGroup(r.groupId, {
      reason: typeof a.reason === "string" ? a.reason : undefined,
      suggestedPrice: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : undefined,
    });
  const lot = r.groupId ? (await loadPool()).groups.find((g) => g.id === r.groupId) : null;
  return {
    ...r,
    lot: lot ? { name: lot.name, pieces: lot.members.length, estTotal: lot.estTotal, ready: lot.ready } : null,
    note: "Grouped. Todd sees it on the Lot pool page and lists it when he's ready." + (lot?.ready ? ` "${lot.name}" is ready to list — tell Todd.` : ""),
  };
}
