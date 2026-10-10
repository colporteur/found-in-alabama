// Listing writer + model router (Phase LIST-2).
//
// For one draft:
//   1. identify — a quick, inexpensive vision pass: what is it, what kind,
//      rough value, how hard. Picks the tier and the Expert Guides.
//   2. write    — the tier's model writes title, description, condition,
//      eBay category (from the categories Todd already lists in), item
//      specifics and a price, using the matched guides and a live supply
//      snapshot (active eBay listings via the gateway).
//   3. retry    — confidence below the setting → once more, one tier up.
//   4. rules    — title/description cleanup, .87 prices and floors,
//      Poshmark floor, Standard Envelope rules (lib/listings/rules.ts).
//
// The draft lands in "review". Nothing is published or sent anywhere: the
// only writes are listing_drafts, ai_runs, ai_call_log and the draft's own
// registry item title.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { gatewayChat, type GatewayContentPart } from "@/lib/gateway";
import { RESEARCH_SYSTEM, parseResearch, researchPromptText, type Research } from "./research";
import { computeLlmCost, getRate, logAiCall } from "@/lib/enhance/cost";
import { listGuides, loadGuide, routeGuides, guideKeywordHits, guideSection, ITEM_SPECIFICS_HEADING, type Guide } from "@/lib/enhance/guides";
import { categoryAspects } from "@/lib/ebay/taxonomy";
import { aspectPromptText, fitSpecifics } from "@/lib/ebay/aspects";
import { buildCategoryOptions } from "@/lib/ebay/auto-categorize";
import { buildSupplyQuery, fetchSupply, REPRICE_DEFAULTS, type SupplySnapshot } from "@/lib/enhance/supply";
import {
  extractJson,
  applyPriceRules,
  cleanCategoryPath,
  guidePromptText,
  nextTier,
  parseIdentification,
  parseWriteOutput,
  parseWriterSettings,
  pickTier,
  rankCategories,
  rankStoreCategories,
  suggestShipping,
  CONDITIONS,
  type CategoryOption,
  type Identification,
  type Tier,
  type WriteOutput,
  type WriterSettings,
} from "./rules";

const APP = "listing-writer";
const SETTINGS_KEY = "listingWriter";
/** A draft stuck in "generating" this long (a crashed run) may be retried. */
const STALE_MINUTES = 10;

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

// ── settings ────────────────────────────────────────────────────────────────

export async function writerSettings(): Promise<WriterSettings> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = ${SETTINGS_KEY}`);
  return parseWriterSettings(r?.value ?? null);
}

export async function saveWriterSettings(raw: unknown): Promise<WriterSettings> {
  const s = parseWriterSettings(raw);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${SETTINGS_KEY}, ${JSON.stringify(s)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  return s;
}

// ── photos ──────────────────────────────────────────────────────────────────

type Photo = { position: number; role: string | null; url: string };

/** Fetch each photo from storage and downsize it (long edge 1568px, the
 *  size vision models actually use) so large scans never exceed a model's
 *  image limit and tokens stay low. */
async function preparePhotos(photos: Photo[]): Promise<{ parts: GatewayContentPart[]; labels: string[]; skipped: string[] }> {
  const parts: GatewayContentPart[] = [];
  const labels: string[] = [];
  const skipped: string[] = [];
  await Promise.all(
    photos.map(async (p, i) => {
      try {
        const res = await fetch(p.url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const out = await sharp(buf, { failOn: "none" })
          .rotate()
          .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        parts[i] = { type: "image_url", image_url: { url: `data:image/jpeg;base64,${out.toString("base64")}` } };
        labels[i] = `Photo ${i + 1}${p.role ? ` (${p.role})` : ""}`;
      } catch (err) {
        skipped.push(`photo ${p.position}: ${(err as Error).message}`);
      }
    })
  );
  return { parts: parts.filter(Boolean), labels: labels.filter(Boolean), skipped };
}

// ── one model call, logged twice (ai_call_log for cost, ai_runs for detail) ─

type CallMeta = {
  draftId: string;
  step: "identify" | "write" | "specifics" | "research";
  tier: Tier | null;
  guides: Array<{ id: string; version: string | null }>;
  who: string;
};

async function callModel(
  model: string,
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>,
  content: GatewayContentPart[],
  maxTokens: number,
  meta: CallMeta,
  extra?: Record<string, unknown>
): Promise<{ text: string; costUsd: number; resolvedModel: string; runId: string | null; durationMs: number }> {
  const started = Date.now();
  const provider = model.split("/")[0] || "gateway";
  try {
    const r = await gatewayChat({ model, system, content, maxTokens, app: APP, ...(extra ? { extra } : {}) });
    const durationMs = Date.now() - started;
    let costUsd = r.usage.costUsd;
    if (costUsd == null) costUsd = computeLlmCost(await getRate(provider, model), r.usage);
    await logAiCall({
      op: `listing_${meta.step}`,
      category: "llm",
      provider,
      model,
      usage: r.usage,
      costUsd,
      durationMs,
      success: true,
    });
    const [run] = await rows(sql`
      INSERT INTO ai_runs (draft_id, app, step, tier, model, resolved_model, guides, input_tokens, output_tokens,
                           cache_read_tokens, cost_usd, duration_ms, success, created_by)
      VALUES (${meta.draftId}, ${APP}, ${meta.step}, ${meta.tier}, ${model}, ${r.model || null},
              ${JSON.stringify(meta.guides)}::jsonb, ${r.usage.inputTokens}, ${r.usage.outputTokens},
              ${r.usage.cacheReadTokens}, ${costUsd.toFixed(6)}, ${durationMs}, true, ${meta.who})
      RETURNING id`);
    return { text: r.text, costUsd, resolvedModel: r.model, runId: run ? String(run.id) : null, durationMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - started;
    await logAiCall({ op: `listing_${meta.step}`, category: "llm", provider, model, costUsd: 0, durationMs, success: false, errorMessage: msg });
    await db.execute(sql`
      INSERT INTO ai_runs (draft_id, app, step, tier, model, guides, duration_ms, success, error, created_by)
      VALUES (${meta.draftId}, ${APP}, ${meta.step}, ${meta.tier}, ${model}, ${JSON.stringify(meta.guides)}::jsonb,
              ${durationMs}, false, ${msg.slice(0, 1000)}, ${meta.who})`);
    throw err;
  }
}

async function noteRun(runId: string | null, confidence: number | null, output: unknown) {
  if (!runId) return;
  await db.execute(sql`
    UPDATE ai_runs SET confidence = ${confidence}, output = ${JSON.stringify(output)}::jsonb WHERE id = ${runId}`);
}

// ── context: guides, supply, categories ─────────────────────────────────────

/** Up to two guides that actually match (most specific first). */
async function matchGuides(text: string): Promise<Guide[]> {
  const pool = (await listGuides()).filter((g) => g.stage !== "buy");
  if (pool.length === 0) return [];
  const t = text.toLowerCase();
  const routed = routeGuides(pool, text);
  // With no keyword hit anywhere, routeGuides falls back to every parent —
  // right for a batch with a chosen family, wrong here: send no guide.
  const hitFamilies = new Set(routed.filter((g) => guideKeywordHits(g, t) > 0).map((g) => g.family));
  if (hitFamilies.size === 0) {
    const famGuides = pool.filter((g) => guideKeywordHits(g, t) > 0);
    if (famGuides.length === 0) return [];
    famGuides.forEach((g) => hitFamilies.add(g.family));
  }
  // routeGuides returns parent then child; the child is the specific one.
  const ordered = routed
    .filter((g) => hitFamilies.has(g.family))
    .sort((a, b) => Number(!!b.parent) - Number(!!a.parent))
    .slice(0, 2);
  const loaded = await Promise.all(ordered.map((g) => loadGuide(g.id)));
  return loaded.filter((g): g is Guide => !!g);
}

type SupplyItem = { title: string; total: number; cls: string; condition?: string };
type SupplyWithItems = SupplySnapshot & { items?: SupplyItem[] };

async function supplySnapshot(title: string): Promise<SupplyWithItems | null> {
  const { q, category } = buildSupplyQuery(title);
  if (!q || q.split(" ").length < 2) return null;
  try {
    return (await fetchSupply(q, { category, excludeSeller: REPRICE_DEFAULTS.excludeSeller })) as SupplyWithItems;
  } catch (err) {
    console.error("[listing-writer] supply snapshot failed:", err);
    return null;
  }
}

let catCache: { at: number; options: CategoryOption[] } | null = null;

/** The eBay categories Todd already lists in (from the listing mirror). */
async function categoryOptions(): Promise<CategoryOption[]> {
  if (catCache && Date.now() - catCache.at < 3_600_000) return catCache.options;
  const found = await rows(sql`
    SELECT site_category_id AS id, max(site_category_name) AS name, count(*) AS c
    FROM ebay_listings WHERE site_category_id IS NOT NULL AND site_category_name IS NOT NULL
    GROUP BY site_category_id HAVING count(*) >= 2 ORDER BY c DESC LIMIT 800`);
  const options = found.map((r) => ({ id: String(r.id), path: cleanCategoryPath(String(r.name)), count: Number(r.c) }));
  catCache = { at: Date.now(), options };
  return options;
}

const BAND_POLICY: Record<string, string> = {
  sole: "SOLE (no one else lists this exact item): price in the upper band for its type — at least the guide's 75th percentile and above the similar-item median. Mention the scarcity premium in the rationale.",
  thin: "THIN (1–4 sellers list the same item): price at or just above the best-conditioned competitor's ask; never under the lowest ask. Do not undercut.",
  crowded: "CROWDED (5+ sellers): price at the active median — not below the second-lowest ask, and not above the maximum unless you can name a concrete hook.",
  adjacent: "ADJACENT (only similar items listed): use the similar-item median as the anchor, adding a premium only for concrete differences (town, subject, era, condition) you can name.",
};

function supplyText(s: SupplyWithItems | null): string {
  if (!s || !s.counted) return "Supply snapshot: unavailable — price from the guide.";
  const st = (x: SupplySnapshot["same_stats"]) => (x ? `n=${x.n}, min $${x.min}, median $${x.median}, max $${x.max}` : "none");
  const items = (s.items ?? []).slice(0, 10).map((i) => `- [${i.cls}] $${i.total} (incl. shipping) — ${i.title}`);
  return [
    `Supply snapshot (ACTIVE eBay listings by other sellers — asking prices, not sold prices) for "${s.q_used ?? s.q}":`,
    `band: ${s.band.toUpperCase()} · same item: ${st(s.same_stats)} · similar: ${st(s.similar_stats)}`,
    BAND_POLICY[s.band] ?? "",
    ...items,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── prompts ─────────────────────────────────────────────────────────────────

function factsText(d: Row): string {
  const f = (d.facts ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  if (d.title_hint) lines.push(`Title hint from intake: ${d.title_hint}`);
  if (f.size_inches) lines.push(`Size: ${f.size_inches} inches`);
  if (f.sku_class) lines.push(`SKU class: ${f.sku_class}`);
  if (d.weight_oz) lines.push(`Weight: ${d.weight_oz} oz`);
  if (Number(d.quantity) > 1) lines.push(`Quantity: ${d.quantity}`);
  if (f.condition) lines.push(`Condition noted at intake: ${f.condition}`);
  if (d.notes) lines.push(`Todd's notes (true facts — use them): ${d.notes}`);
  if (f.estate_title || f.estate_description) {
    // Estate Photo Sorter already wrote a listing: a starting point to
    // improve, not a source of new facts beyond what the photos show.
    lines.push(
      [
        "Estate Photo Sorter's draft (written from these photos; improve it, keep what's accurate):",
        f.estate_title ? `- title: ${f.estate_title}` : "",
        f.estate_price != null ? `- price: $${f.estate_price}` : "",
        f.estate_description ? `- description: ${String(f.estate_description).slice(0, 1600)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  const research = researchPromptText(((d.ai_meta ?? {}) as Record<string, unknown>).research as Research | undefined);
  if (research) lines.push(research);
  return lines.length ? lines.join("\n") : "No intake facts beyond the photos.";
}

const IDENTIFY_SYSTEM = `You identify vintage and collectible items from photos for "Found in Alabama", an Alabama reseller, so the right expert guide and model can be chosen. Look at every photo (fronts, backs, labels, signatures, postmarks, publisher lines).
The reseller being in Alabama says NOTHING about where an item is from — most items are from elsewhere. "places" lists only places printed, written or pictured on the item (or stated in the intake facts); never guess a place from a business or family name. Leave "places" empty if none is shown.

Return ONLY a JSON object, no commentary:
{
  "identification": "one line: what this exact item is (subject, place, maker, format, era)",
  "kind": "postcard | photograph | ephemera | book | magazine | record | artwork | trading_card | greeting_card | map | document | other",
  "card_type": "rppc | early | whiteborder | linen | chrome | holiday | other | nonpostcard",
  "keywords": ["up to 12 words buyers search: places, subjects, makers, era, format"],
  "era": "e.g. 1940s, c. 1910, 1970s",
  "places": ["City, ST"],
  "signed": false,
  "est_value_usd": 0,
  "difficulty": "simple | general | hard",
  "confidence": 0.0,
  "notes": "anything uncertain"
}
card_type applies to postcards: rppc = real photo postcard; early = before ~1915 (undivided back, private mailing card); whiteborder ≈1915–1930; linen ≈1930–1950; chrome ≈1939 on; holiday = greetings/holiday; nonpostcard for anything else.
difficulty: simple = a common item that is easy to describe (most postcards, ordinary paper); hard = artwork, autographs, rare or valuable pieces, or anything you can't pin down.
est_value_usd: a typical eBay sold price for this kind of item.`;

const WRITE_RULES = `You write marketplace listings for "Found in Alabama", an Alabama reseller of vintage paper, postcards, photographs, books and collectibles. The listing goes to eBay first and is crosslisted to Mercari, Poshmark, Depop and Whatnot.

NON-NEGOTIABLE RULES (they override the expert guide):
1. Never invent facts. Places, dates, publishers, makers, provenance and condition must be visible in the photos or stated in the intake facts. When unsure, leave it out or say "appears to be". Todd's notes are true.
1b. The seller being "Found in Alabama" does not make an item Alabama. Put a city or state in the title, description, specifics or store shelf ONLY if it is printed/written/pictured on the item or given in the intake facts — never from a guess (a "likely" or "possibly" place from the identification step is a guess). If you think you know where a business was, say so in flags, not in the listing.
1c. In flags, name the real source of a doubt ("the photos", "the identification step"); the title hint is only Todd's few words from intake.
2. Never mention shipping, packing, handling time, discounts, returns, payment or price in the title or description.
3. Never include bin or SKU codes (e.g. NA331) anywhere.

TITLE: at most 80 characters, and use the room — aim for 70–80 (add place, era, maker, format words buyers search; eBay ranks on them). Front-load what buyers search, following the guide's title formula. No ALL-CAPS words except real acronyms (RPPC), no filler (WOW, L@@K, RARE unless the guide supports it), no quotes.

DESCRIPTION: plain text only — no HTML, no markdown, no bullet symbols other than "•". At most 1,400 characters. The FIRST 1,000 characters must stand alone because Mercari and Depop cut off after that, so the FIRST paragraph must say what the item is, its key identifying details, its size if known, AND a one-sentence condition summary. Extra detail (contents, history of the place, publisher notes) comes after. Write 2–4 short paragraphs separated by a blank line — never one solid block.

CONDITION: one of: ${CONDITIONS.join(", ")}. For vintage paper "Used" is normal. condition_note: the specific visible flaws (corner wear, creases, writing, postmark/stamp, toning, pin holes, trimming), or "" if none are visible. Do not overclaim.

CATEGORY: choose ebay_category_id from the list provided (they are the categories this store uses). If none fits, return null and put the eBay category path you would use in ebay_category_suggestion.

STORE CATEGORIES: pick two of the store's own shelves (store_category_ids) from the list provided.
- First: the shelf for what the item IS.
- Second: a place shelf ONLY when the photos or facts clearly tie the item to a place — an Alabama shelf (marked [AL]) for Alabama, or that state's shelf under "Found in Other States" for another US state. Do not guess a state.
- Otherwise the second is the next-best shelf a buyer might browse for this item (its subject, theme, era, maker or use), different from the first and not a near-duplicate of it. Always try to find a good second shelf; leave it out only when nothing on the list genuinely fits.

ITEM SPECIFICS: eBay item specific names and values for that category (follow the guide's item specifics map if it has one). Only values you are sure of; omit the rest. Typical for postcards: Type, Theme, Subject, City, State, Region, Country/Region of Manufacture, Era, Postage Condition, Publisher, Original/Licensed Reprint, Size.

PRICE: a Buy It Now price in USD for eBay, using the guide's pricing rules and the supply snapshot policy. Real comps outrank the guide. Give price_low / price_high for a fair range and price_rationale (one or two sentences naming the evidence).

Return ONLY this JSON object:
{
  "title": "",
  "description": "",
  "condition": "",
  "condition_note": "",
  "ebay_category_id": "",
  "ebay_category_suggestion": "",
  "store_category_ids": ["", ""],
  "item_specifics": { "Name": "value" },
  "price": 0,
  "price_low": 0,
  "price_high": 0,
  "price_rationale": "",
  "confidence": 0.0,
  "flags": ["things Todd should check before approving"]
}
confidence (0–1): how sure you are of the identification and the facts in the listing.`;

const SPECIFICS_SYSTEM = `You fill in eBay item specifics for one listing, using ONLY the field names in the category's list.

Rules:
- Use facts from the title, description, identification and intake facts. Never invent brands, makers, publishers, dates or places. Leave a field out rather than guess.
- For fields marked "choose from", use one of the listed values exactly as written.
- Fill every REQUIRED field you can, then the recommended ones, then any optional ones the listing clearly supports.
- "one value" fields get a single string; "several values ok" fields may get a list of strings.
- Values are short (1–4 words), in the form buyers filter by.

Return ONLY a JSON object: { "Field name": "value" | ["value", "value"] }`;

// ── the run ─────────────────────────────────────────────────────────────────

export type GenerateOptions = {
  /** Force a tier instead of routing ("auto" or omitted = route). */
  tier?: Tier | "auto";
  /** Todd's corrections for this run; they override everything else. */
  corrections?: string | null;
  who: string;
};

export type GenerateResult =
  | { ok: true; draftId: string; status: "review"; tier: Tier; model: string; confidence: number | null; costUsd: number }
  | { ok: false; status: number; error: string };

const WRITABLE = ["ready", "review", "sent_back", "generating"];

export async function generateDraft(draftId: string, opts: GenerateOptions): Promise<GenerateResult> {
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return { ok: false, status: 404, error: "Draft not found" };
  const [d] = await rows(sql`SELECT * FROM listing_drafts WHERE id = ${draftId}`);
  if (!d) return { ok: false, status: 404, error: "Draft not found" };
  const prev = String(d.status);
  if (!WRITABLE.includes(prev)) {
    return { ok: false, status: 409, error: `A draft that is "${prev.replace("_", " ")}" can't be written` };
  }

  // Claim it: only one run per draft at a time.
  const claimed = await rows(sql`
    UPDATE listing_drafts SET status = 'generating', generation_started_at = now(), generation_error = NULL, updated_at = now()
    WHERE id = ${draftId} AND status = ${prev}
      AND (status <> 'generating' OR generation_started_at IS NULL
           OR generation_started_at < now() - make_interval(mins => ${STALE_MINUTES}))
    RETURNING id`);
  if (claimed.length === 0) return { ok: false, status: 409, error: "This draft is already being written" };
  const restore = prev === "generating" ? "ready" : prev;

  let totalCost = 0;
  try {
    const settings = await writerSettings();
    const photoRows = await rows(sql`
      SELECT position, role, url FROM draft_photos WHERE draft_id = ${draftId} AND uploaded_at IS NOT NULL
      ORDER BY position LIMIT ${settings.maxPhotos}`);
    if (photoRows.length === 0) throw new Error("No uploaded photos to write from");
    const photos = await preparePhotos(
      photoRows.map((p) => ({ position: Number(p.position), role: p.role ? String(p.role) : null, url: String(p.url) }))
    );
    if (photos.parts.length === 0) throw new Error(`Couldn't load the photos (${photos.skipped.join("; ")})`);

    const facts = factsText(d);
    const prevMeta = (d.ai_meta ?? {}) as Record<string, unknown>;
    const corrections = (opts.corrections ?? (prev === "sent_back" ? (d.review_note as string | null) : null) ?? "").trim();
    const correctionBlock = corrections
      ? `\n\nTODD'S CORRECTIONS (true; they override the photos' reading, the guide and everything above): ${corrections}`
      : "";

    // 1. identify (skipped on a forced-tier regenerate when we already know the item)
    let ident: Identification | null =
      opts.tier && opts.tier !== "auto" && !corrections && prevMeta.identification
        ? (prevMeta.identification as Identification)
        : null;
    if (!ident) {
      const idCall = await callModel(
        settings.identifyModel,
        [{ type: "text", text: IDENTIFY_SYSTEM }],
        [...photos.parts.slice(0, 3), { type: "text", text: `${facts}${correctionBlock}` }],
        800,
        { draftId, step: "identify", tier: null, guides: [], who: opts.who }
      );
      totalCost += idCall.costUsd;
      ident = parseIdentification(idCall.text);
      await noteRun(idCall.runId, ident?.confidence ?? null, ident ?? { raw: idCall.text.slice(0, 2000) });
    }

    const routed = pickTier(ident, (d.facts ?? {}) as Record<string, unknown>);
    let tier: Tier = opts.tier && opts.tier !== "auto" ? opts.tier : routed.tier;
    const tierReason = opts.tier && opts.tier !== "auto" ? "chosen by hand" : routed.reason;

    // 2. context
    const routeText = [ident?.identification, ident?.kind, ...(ident?.keywords ?? []), d.title_hint, d.notes]
      .filter(Boolean)
      .join(" ");
    const [guides, supply, cats] = await Promise.all([
      matchGuides(routeText),
      supplySnapshot(String(d.title_hint || ident?.identification || "")),
      categoryOptions(),
    ]);
    const candidates = rankCategories(cats, routeText, 40);
    const catIds = new Set(candidates.map((c) => c.id));
    const storeOptions = await buildCategoryOptions().catch(() => []);
    const storeCands = rankStoreCategories(
      storeOptions.map((o) => ({ id: o.id, path: o.path.replace(/&amp;/g, "&"), isAlabama: o.isAlabama })),
      routeText,
      120
    );
    const storeIds = new Set(storeCands.map((c) => c.id));
    const guideRefs = guides.map((g) => ({ id: g.id, version: g.version ?? g.updated ?? null }));
    const guideText = guides.length ? guidePromptText(guides.map((g) => ({ id: g.id, name: g.name, content: g.content }))) : "";

    const userText = [
      `Photos: ${photos.labels.join(", ")}.`,
      facts,
      ident ? `Quick identification (a first look — the photos win if they disagree): ${ident.identification}; kind ${ident.kind}; era ${ident.era || "?"}; places ${ident.places.join(", ") || "?"}.` : "",
      supplyText(supply),
      `eBay categories this store uses (id — path):\n${candidates.map((c) => `${c.id} — ${c.path}`).join("\n")}`,
      storeCands.length
        ? `The store's own shelves (eBay store categories; id — path):\n${storeCands.map((c) => `${c.id} — ${c.isAlabama ? "[AL] " : ""}${c.path}`).join("\n")}`
        : "",
      guides.length ? "" : "No expert guide matched this item; rely on general collectibles knowledge and be conservative on price.",
      correctionBlock.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");

    const system = [
      ...(guideText ? [{ type: "text" as const, text: guideText, cache_control: { type: "ephemeral" as const } }] : []),
      { type: "text" as const, text: WRITE_RULES },
    ];

    // 3. write, retrying one tier up on low confidence or an unusable reply
    const attempts: Array<{ tier: Tier; model: string; out: WriteOutput | null; error?: string; resolvedModel: string }> = [];
    for (let i = 0; i < 2; i++) {
      const model = settings.models[tier];
      const call = await callModel(model, system, [...photos.parts, { type: "text", text: userText }], 8000, {
        draftId,
        step: "write",
        tier,
        guides: guideRefs,
        who: opts.who,
      });
      totalCost += call.costUsd;
      const parsed = parseWriteOutput(call.text, { binSku: d.bin_sku as string | null, categoryIds: catIds, storeCategoryIds: storeIds });
      await noteRun(call.runId, parsed.ok ? parsed.value.confidence : null, parsed.ok ? parsed.value : { error: parsed.error, raw: call.text.slice(0, 4000) });
      attempts.push({ tier, model, out: parsed.ok ? parsed.value : null, error: parsed.ok ? undefined : parsed.error, resolvedModel: call.resolvedModel });
      const conf = parsed.ok ? parsed.value.confidence ?? 1 : 0;
      const up = nextTier(tier);
      const forced = opts.tier && opts.tier !== "auto";
      if ((parsed.ok && conf >= settings.retryBelow) || !up || forced) break;
      tier = up;
    }
    const best = attempts
      .filter((a) => a.out)
      .sort((a, b) => (b.out!.confidence ?? 1) - (a.out!.confidence ?? 1))[0];
    if (!best || !best.out) throw new Error(attempts.map((a) => a.error).filter(Boolean).join("; ") || "The writer returned nothing usable");
    const out = best.out;

    // 4. rules
    const cat = candidates.find((c) => c.id === out.ebayCategoryId) ?? null;
    const isPostcard = ident?.kind === "postcard" || /postcard/i.test(cat?.path ?? "");
    const priced =
      out.price != null
        ? applyPriceRules({
            suggested: out.price,
            cardType: ident?.cardType ?? "nonpostcard",
            isPostcard,
            floor: settings.floor,
            poshmarkFloor: settings.poshmarkFloor,
          })
        : null;
    // 4b. item specifics that fit the chosen eBay category: look up the
    // category's real fields (Taxonomy API, cached) and have the
    // inexpensive model fill them from the finished listing (text only).
    let specifics = out.itemSpecifics;
    const specFlags: string[] = [];
    const aspects = cat ? await categoryAspects(cat.id) : null;
    if (aspects && aspects.length) {
      const map = guides.map((g) => guideSection(g.content, ITEM_SPECIFICS_HEADING)).filter(Boolean).join("\n\n").slice(0, 4000);
      try {
        const sp = await callModel(
          settings.identifyModel,
          [{ type: "text", text: SPECIFICS_SYSTEM }],
          [
            {
              type: "text",
              text: [
                `eBay category: ${cat!.path}`,
                `Title: ${out.title}`,
                `Description:\n${out.description}`,
                `Condition: ${out.condition}${out.conditionNote ? ` — ${out.conditionNote}` : ""}`,
                ident ? `Identification: ${ident.identification}; era ${ident.era || "?"}; places ${ident.places.join(", ") || "?"}` : "",
                facts,
                Object.keys(out.itemSpecifics).length ? `First-draft specifics (may use wrong names): ${JSON.stringify(out.itemSpecifics)}` : "",
                map ? `Expert guide item specifics map:\n${map}` : "",
                `This category's item specifics:\n${aspectPromptText(aspects)}`,
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
          1500,
          { draftId, step: "specifics", tier: null, guides: guideRefs, who: opts.who }
        );
        totalCost += sp.costUsd;
        const parsed = extractJson(sp.text);
        const raw: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(parsed ?? {})) {
          if (Array.isArray(v)) raw[k] = v.map(String);
          else if (v != null && String(v).trim()) raw[k] = String(v);
        }
        const fit = fitSpecifics({ ...out.itemSpecifics, ...raw }, aspects);
        await noteRun(sp.runId, null, { specifics: fit.kept, dropped: fit.dropped });
        specifics = fit.kept;
        if (fit.missingRequired.length) specFlags.push(`eBay requires: ${fit.missingRequired.join(", ")} — still empty`);
      } catch (err) {
        const fit = fitSpecifics(out.itemSpecifics, aspects);
        specifics = fit.kept;
        specFlags.push(`Item specifics step failed (${(err as Error).message.slice(0, 80)}); kept the ones that fit the category`);
      }
    }

    const ship = priced
      ? suggestShipping({ price: priced.price, categoryPath: cat?.path ?? out.ebayCategorySuggestion, kind: ident?.kind ?? "other", weightOz: d.weight_oz != null ? Number(d.weight_oz) : null })
      : null;

    const aiMeta = {
      tier: best.tier,
      tierReason,
      model: best.model,
      resolvedModel: best.resolvedModel,
      attempts: attempts.map((a) => ({ tier: a.tier, model: a.model, confidence: a.out?.confidence ?? null, error: a.error ?? null })),
      identification: ident,
      guides: guides.map((g) => ({ id: g.id, name: g.name, version: g.version ?? g.updated ?? null })),
      supply: supply
        ? { q: supply.q_used ?? supply.q, band: supply.band, same: supply.same_stats, similar: supply.similar_stats, items: (supply.items ?? []).slice(0, 6) }
        : null,
      confidence: out.confidence,
      flags: [...out.flags, ...specFlags, ...photos.skipped.map((s) => `skipped ${s}`)],
      aspectsChecked: !!(aspects && aspects.length),
      priceSuggested: out.price,
      priceLow: out.priceLow,
      priceHigh: out.priceHigh,
      priceRationale: out.priceRationale,
      priceNotes: priced?.notes ?? [],
      shippingReason: ship?.reason ?? null,
      categorySuggestion: cat ? null : out.ebayCategorySuggestion || null,
      corrections: corrections || null,
      research: prevMeta.research ?? null,
      costUsd: Math.round(totalCost * 10000) / 10000,
      writtenAt: new Date().toISOString(),
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
        written_by = 'ai',
        review_note = NULL,
        status = 'review',
        generation_started_at = NULL,
        generation_error = NULL,
        updated_at = now()
      WHERE id = ${draftId} AND status = 'generating'
      RETURNING id`);
    if (saved.length === 0) {
      // Discarded (or otherwise changed) while the writer was working.
      return { ok: false, status: 409, error: "The draft changed while it was being written; the result was not saved" };
    }
    if (d.registry_item_id) {
      await db.execute(sql`
        UPDATE registry_items SET title = ${out.title},
          title_normalized = lower(regexp_replace(trim(${out.title}), '\\s+', ' ', 'g')), updated_at = now()
        WHERE id = ${String(d.registry_item_id)} AND status = 'draft'`);
    }
    return { ok: true, draftId, status: "review", tier: best.tier, model: best.model, confidence: out.confidence, costUsd: aiMeta.costUsd };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    await db.execute(sql`
      UPDATE listing_drafts SET status = ${restore}, generation_started_at = NULL, generation_error = ${msg}, updated_at = now()
      WHERE id = ${draftId} AND status = 'generating'`);
    return { ok: false, status: 502, error: msg };
  }
}

/** Drafts the bulk "Write all ready" button works through: ready, with
 *  photos, and not marked "I'll write it myself" in the manual lister. */
export async function writableDraftIds(limit = 200): Promise<string[]> {
  const found = await rows(sql`
    SELECT id FROM listing_drafts
    WHERE status = 'ready' AND COALESCE(facts->>'mode', '') <> 'hand'
    ORDER BY created_at LIMIT ${limit}`);
  return found.map((r) => String(r.id));
}


// ── research (LIST-4): top model + web search + guides, on demand ──────────

const RESEARCH_PHOTOS = 6;

export async function researchDraft(
  draftId: string,
  opts: { question?: string | null; who: string }
): Promise<{ ok: true; research: Research } | { ok: false; status: number; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return { ok: false, status: 404, error: "Draft not found" };
  const [d] = await rows(sql`SELECT * FROM listing_drafts WHERE id = ${draftId}`);
  if (!d) return { ok: false, status: 404, error: "Draft not found" };
  if (["published", "discarded"].includes(String(d.status))) {
    return { ok: false, status: 409, error: `A ${d.status} draft can't be researched` };
  }
  const settings = await writerSettings();
  const photoRows = await rows(sql`
    SELECT position, role, url FROM draft_photos WHERE draft_id = ${draftId} AND uploaded_at IS NOT NULL
    ORDER BY position LIMIT ${RESEARCH_PHOTOS}`);
  const photos = await preparePhotos(
    photoRows.map((p) => ({ position: Number(p.position), role: p.role ? String(p.role) : null, url: String(p.url) }))
  );
  const meta = (d.ai_meta ?? {}) as Record<string, unknown>;
  const ident = (meta.identification ?? null) as Identification | null;
  const routeText = [d.title, ident?.identification, ...(ident?.keywords ?? []), d.title_hint, d.notes].filter(Boolean).join(" ");
  const guides = await matchGuides(routeText);
  const guideText = guides.length ? guidePromptText(guides.map((g) => ({ id: g.id, name: g.name, content: g.content }))) : "";
  const question = (opts.question ?? "").trim().slice(0, 600) || null;
  // The earlier research is not fed back in: a fresh look each time.
  const factsNoResearch = factsText({ ...d, ai_meta: { ...meta, research: null } });
  const userText = [
    photos.labels.length ? `Photos: ${photos.labels.join(", ")}.` : "No photos could be loaded.",
    factsNoResearch,
    d.title ? `Current draft title: ${d.title}` : "",
    d.description ? `Current draft description: ${String(d.description).slice(0, 1500)}` : "",
    ident ? `First-look identification (may be wrong): ${ident.identification}` : "",
    question ? `TODD'S QUESTION — answer this first: ${question}` : "Find what would make this listing more attractive and searchable.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const system = [
    ...(guideText ? [{ type: "text" as const, text: guideText, cache_control: { type: "ephemeral" as const } }] : []),
    { type: "text" as const, text: RESEARCH_SYSTEM },
  ];
  const model = settings.models.premium;
  try {
    const call = await callModel(
      model,
      system,
      [...photos.parts, { type: "text", text: userText }],
      4000,
      { draftId, step: "research", tier: "premium", guides: guides.map((g) => ({ id: g.id, version: g.version ?? g.updated ?? null })), who: opts.who },
      { plugins: [{ id: "web", max_results: 6 }] }
    );
    const parsed = parseResearch(call.text);
    if (!parsed) {
      await noteRun(call.runId, null, { raw: call.text.slice(0, 2000) });
      return { ok: false, status: 502, error: "The research reply couldn't be read; try again." };
    }
    const research: Research = {
      ...parsed,
      at: new Date().toISOString(),
      model: call.resolvedModel || model,
      costUsd: Math.round(call.costUsd * 10000) / 10000,
      question,
      titleOk: false,
    };
    await noteRun(call.runId, null, research);
    await db.execute(sql`
      UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('research', ${JSON.stringify(research)}::jsonb),
             updated_at = now()
      WHERE id = ${draftId}`);
    return { ok: true, research };
  } catch (err) {
    return { ok: false, status: 502, error: (err as Error).message.slice(0, 300) };
  }
}

/** Todd's picks: which findings the next write uses, and whether LIKELY
 *  places may go in the title. */
export async function setResearchPicks(draftId: string, use: number[], titleOk: boolean): Promise<boolean> {
  const [d] = await rows(sql`SELECT ai_meta FROM listing_drafts WHERE id = ${draftId}`);
  const r = ((d?.ai_meta ?? {}) as Record<string, unknown>).research as Research | undefined;
  if (!r) return false;
  const picked = new Set(use);
  const next: Research = { ...r, titleOk, findings: r.findings.map((f, i) => ({ ...f, use: picked.has(i) })) };
  await db.execute(sql`
    UPDATE listing_drafts SET ai_meta = ai_meta || jsonb_build_object('research', ${JSON.stringify(next)}::jsonb), updated_at = now()
    WHERE id = ${draftId}`);
  return true;
}
