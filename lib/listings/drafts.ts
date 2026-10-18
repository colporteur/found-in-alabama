// Read + edit listing drafts for the admin (Phase LIST-1).

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;

async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));

export const DRAFT_STATUSES = [
  "uploading",
  "ready",
  "generating",
  "review",
  "approved",
  "in_nifty",
  "published",
  "sent_back",
  /** Queued for Claude in the Claude app to write through the FIA connector. */
  "with_claude",
  /** A lot Todd is holding open for more pieces (lib/listings/open-lots.ts). */
  "lot_open",
  /** Set aside in the lot pool (bin LOTPOOL) until its lot is listed. */
  "pooled",
  "discarded",
] as const;

export type DraftPhoto = {
  position: number;
  role: string | null;
  url: string;
  uploaded: boolean;
  name: string | null;
  /** Clockwise degrees Todd turned it on the draft page. */
  rotation: number;
};

export type DraftSummary = {
  id: string;
  status: string;
  source: string;
  sourceLabel: string | null;
  title: string | null;
  titleHint: string | null;
  binSku: string | null;
  price: number | null;
  photos: number;
  cover: string | null;
  createdAt: string;
  /** Writer's confidence (0–1) and tier, once written. */
  confidence: number | null;
  tier: string | null;
  writtenBy: string | null;
  generationError: string | null;
  /** Table view fields. */
  weightOz: number | null;
  /** The writer's assumed weight when none was entered (postcard 1 oz…). */
  assumedWeightOz: number | null;
  ebayCategoryId: string | null;
  ebayCategoryName: string | null;
  shippingProfile: string | null;
  quantity: number;
  condition: string | null;
  poshmarkPrice: number | null;
  storeCategoryIds: string[];
  /** Pieces combined into this lot (lib/listings/lots.ts), or null. */
  lotOf: number | null;
  /** A lot built from the lot pool (pieces pulled from LOTPOOL / candidates). */
  fromPool?: boolean;
};

/** Statuses whose content can still be edited by hand. */
export const EDITABLE_STATUS_LIST = ["uploading", "ready", "review", "sent_back"] as const;

export type Draft = Omit<DraftSummary, "weightOz" | "assumedWeightOz" | "ebayCategoryId" | "ebayCategoryName" | "shippingProfile" | "quantity" | "condition" | "poshmarkPrice" | "storeCategoryIds"> & {
  registryItemId: string | null;
  sourceRef: string | null;
  facts: Record<string, unknown>;
  notes: string | null;
  weightOz: number | null;
  quantity: number;
  description: string | null;
  condition: string | null;
  conditionNote: string | null;
  ebayCategoryId: string | null;
  ebayCategoryName: string | null;
  itemSpecifics: Record<string, string | string[]> | null;
  venuePrices: Record<string, number> | null;
  reviewNote: string | null;
  createdBy: string | null;
  updatedAt: string;
  photoList: DraftPhoto[];
  shippingProfile: string | null;
  aiMeta: Record<string, unknown> | null;
  generationStartedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  storeCategoryIds: string[];
  niftyItemId: string | null;
  niftySentAt: string | null;
  niftyError: string | null;
  niftyWarnings: string[];
};

export async function draftsReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.listing_drafts') IS NOT NULL AS ok`);
  return !!r?.ok;
}

export async function listDrafts(status: string | null, limit = 100): Promise<{
  drafts: DraftSummary[];
  counts: Record<string, number>;
}> {
  const filter = status ? sql`WHERE d.status = ${status}` : sql`WHERE d.status <> 'discarded'`;
  const found = await rows(sql`
    SELECT d.id, d.status, d.source, d.source_label, d.title, d.title_hint, d.bin_sku, d.price, d.created_at,
           d.written_by, d.generation_error, d.ai_meta->>'confidence' AS confidence, d.ai_meta->>'tier' AS tier,
           d.weight_oz, d.ai_meta->'weight'->>'oz' AS assumed_oz, d.ebay_category_id, d.ebay_category_name,
           d.shipping_profile, d.quantity, d.condition, d.venue_prices->>'poshmark' AS poshmark_price, d.store_category_ids,
           jsonb_array_length(COALESCE(d.ai_meta->'lot'->'parts', '[]'::jsonb)) AS lot_parts,
           (d.ai_meta->'lot' ? 'poolGroupId' OR d.ai_meta->'lot' ? 'poolMemberIds') AS from_pool,
           (SELECT count(*) FROM draft_photos p WHERE p.draft_id = d.id) AS photos,
           (SELECT p.url FROM draft_photos p WHERE p.draft_id = d.id AND p.uploaded_at IS NOT NULL
             ORDER BY p.position LIMIT 1) AS cover
    FROM listing_drafts d ${filter}
    ORDER BY d.created_at DESC LIMIT ${limit}`);
  const counts: Record<string, number> = {};
  for (const c of await rows(sql`SELECT status, count(*) AS c FROM listing_drafts GROUP BY status`)) {
    counts[String(c.status)] = Number(c.c);
  }
  return {
    counts,
    drafts: found.map((d) => ({
      id: String(d.id),
      status: String(d.status),
      source: String(d.source),
      sourceLabel: s(d.source_label),
      title: s(d.title),
      titleHint: s(d.title_hint),
      binSku: s(d.bin_sku),
      price: n(d.price),
      photos: Number(d.photos),
      cover: s(d.cover),
      createdAt: String(d.created_at),
      confidence: n(d.confidence),
      tier: s(d.tier),
      writtenBy: s(d.written_by),
      generationError: s(d.generation_error),
      weightOz: n(d.weight_oz),
      assumedWeightOz: n(d.assumed_oz),
      ebayCategoryId: s(d.ebay_category_id),
      ebayCategoryName: s(d.ebay_category_name),
      shippingProfile: s(d.shipping_profile),
      quantity: Number(d.quantity ?? 1) || 1,
      condition: s(d.condition),
      poshmarkPrice: n(d.poshmark_price),
      storeCategoryIds: Array.isArray(d.store_category_ids) ? (d.store_category_ids as unknown[]).map(String) : [],
      lotOf: Number(d.lot_parts) || null,
      fromPool: d.from_pool === true,
    })),
  };
}

export async function loadDraft(id: string): Promise<Draft | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [d] = await rows(sql`SELECT * FROM listing_drafts WHERE id = ${id}`);
  if (!d) return null;
  const photos = await rows(sql`
    SELECT position, role, url, uploaded_at, original_name, COALESCE((to_jsonb(draft_photos)->>'rotation')::int, 0) AS rotation
    FROM draft_photos WHERE draft_id = ${id} ORDER BY position`);
  const photoList = photos.map((p) => ({
    position: Number(p.position),
    role: s(p.role),
    url: String(p.url),
    uploaded: p.uploaded_at != null,
    name: s(p.original_name),
    rotation: Number(p.rotation ?? 0),
  }));
  return {
    id: String(d.id),
    status: String(d.status),
    source: String(d.source),
    sourceLabel: s(d.source_label),
    sourceRef: s(d.source_ref),
    title: s(d.title),
    titleHint: s(d.title_hint),
    binSku: s(d.bin_sku),
    price: n(d.price),
    photos: photoList.length,
    cover: photoList.find((p) => p.uploaded)?.url ?? null,
    createdAt: String(d.created_at),
    confidence: n((d.ai_meta as Record<string, unknown> | null)?.confidence),
    tier: s((d.ai_meta as Record<string, unknown> | null)?.tier),
    generationError: s(d.generation_error),
    registryItemId: s(d.registry_item_id),
    facts: (d.facts as Record<string, unknown>) ?? {},
    notes: s(d.notes),
    weightOz: n(d.weight_oz),
    quantity: Number(d.quantity ?? 1),
    description: s(d.description),
    condition: s(d.condition),
    conditionNote: s(d.condition_note),
    ebayCategoryId: s(d.ebay_category_id),
    ebayCategoryName: s(d.ebay_category_name),
    itemSpecifics: (d.item_specifics as Record<string, string | string[]> | null) ?? null,
    venuePrices: (d.venue_prices as Record<string, number> | null) ?? null,
    writtenBy: s(d.written_by),
    reviewNote: s(d.review_note),
    createdBy: s(d.created_by),
    updatedAt: String(d.updated_at),
    photoList,
    shippingProfile: s(d.shipping_profile),
    aiMeta: (d.ai_meta as Record<string, unknown> | null) ?? null,
    generationStartedAt: s(d.generation_started_at),
    approvedAt: s(d.approved_at),
    approvedBy: s(d.approved_by),
    storeCategoryIds: (d.store_category_ids as string[] | null) ?? [],
    niftyItemId: s(d.nifty_item_id),
    niftySentAt: s(d.nifty_sent_at),
    niftyError: s(d.nifty_error),
    niftyWarnings: (d.nifty_warnings as string[] | null) ?? [],
    lotOf: (((d.ai_meta as Record<string, unknown> | null)?.lot as { parts?: unknown[] } | undefined)?.parts ?? []).length || null,
    fromPool: (() => {
      const lot = (d.ai_meta as Record<string, unknown> | null)?.lot as Record<string, unknown> | undefined;
      return !!lot && ("poolGroupId" in lot || "poolMemberIds" in lot);
    })(),
  };
}

export type DraftEdit = {
  title?: string | null;
  description?: string | null;
  condition?: string | null;
  conditionNote?: string | null;
  ebayCategoryId?: string | null;
  ebayCategoryName?: string | null;
  itemSpecifics?: Record<string, string | string[]> | null;
  price?: number | null;
  binSku?: string | null;
  weightOz?: number | null;
  quantity?: number;
  notes?: string | null;
  shippingProfile?: string | null;
  /** Poshmark's own price (null clears it). */
  poshmarkPrice?: number | null;
  storeCategoryIds?: string[] | null;
};

/** "Brand: Curt Teich\nEra: Linen (1930-1945)" → { Brand: "Curt Teich", … }.
 *  Values with " | " become lists. */
export function parseSpecifics(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!k || !v) continue;
    out[k] = v.includes(" | ") ? v.split(" | ").map((x) => x.trim()).filter(Boolean) : v;
  }
  return out;
}

export function formatSpecifics(spec: Record<string, string | string[]> | null): string {
  if (!spec) return "";
  return Object.entries(spec)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" | ") : v}`)
    .join("\n");
}

const EDITABLE_STATUSES = new Set<string>(EDITABLE_STATUS_LIST);

export async function updateDraft(id: string, edit: DraftEdit): Promise<{ ok: boolean; error?: string }> {
  const [d] = await rows(sql`SELECT status, registry_item_id FROM listing_drafts WHERE id = ${id}`);
  if (!d) return { ok: false, error: "Draft not found" };
  if (!EDITABLE_STATUSES.has(String(d.status))) return { ok: false, error: `A ${d.status} draft can't be edited` };
  const sets = [];
  const col = (name: string, v: unknown) => sets.push(sql`${sql.raw(name)} = ${v}`);
  if ("title" in edit) col("title", edit.title);
  if ("description" in edit) col("description", edit.description);
  if ("condition" in edit) col("condition", edit.condition);
  if ("conditionNote" in edit) col("condition_note", edit.conditionNote);
  if ("ebayCategoryId" in edit) col("ebay_category_id", edit.ebayCategoryId);
  if ("ebayCategoryName" in edit) col("ebay_category_name", edit.ebayCategoryName);
  if ("itemSpecifics" in edit) sets.push(sql`item_specifics = ${edit.itemSpecifics ? JSON.stringify(edit.itemSpecifics) : null}::jsonb`);
  if ("price" in edit) col("price", edit.price);
  if ("binSku" in edit) col("bin_sku", edit.binSku);
  if ("weightOz" in edit) col("weight_oz", edit.weightOz);
  if ("quantity" in edit) col("quantity", edit.quantity);
  if ("notes" in edit) col("notes", edit.notes);
  if ("shippingProfile" in edit) col("shipping_profile", edit.shippingProfile);
  if ("storeCategoryIds" in edit) {
    sets.push(sql`store_category_ids = ${edit.storeCategoryIds?.length ? JSON.stringify(edit.storeCategoryIds) : null}::jsonb`);
  }
  if ("poshmarkPrice" in edit) {
    sets.push(
      edit.poshmarkPrice
        ? sql`venue_prices = COALESCE(venue_prices, '{}'::jsonb) || jsonb_build_object('poshmark', ${edit.poshmarkPrice}::numeric)`
        : sql`venue_prices = NULLIF(COALESCE(venue_prices, '{}'::jsonb) - 'poshmark', '{}'::jsonb)`
    );
  }
  if (sets.length === 0) return { ok: true };
  sets.push(sql`written_by = CASE WHEN written_by IS NULL OR written_by = 'hand' THEN 'hand'
                                 WHEN written_by LIKE 'claude%' THEN 'claude+hand' ELSE 'ai+hand' END`);
  sets.push(sql`updated_at = now()`);
  await db.execute(sql`UPDATE listing_drafts SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
  // Keep the registry item's title / bin in step with the draft.
  if (d.registry_item_id && (edit.title || "binSku" in edit)) {
    await db.execute(sql`
      UPDATE registry_items r SET
        title = COALESCE(${edit.title ?? null}, r.title),
        title_normalized = lower(regexp_replace(trim(COALESCE(${edit.title ?? null}, r.title)), '\\s+', ' ', 'g')),
        bin_sku = CASE WHEN ${"binSku" in edit}::boolean THEN ${edit.binSku ?? null} ELSE r.bin_sku END,
        updated_at = now()
      WHERE r.id = ${String(d.registry_item_id)} AND r.status = 'draft'`);
  }
  return { ok: true };
}

export async function setDraftStatus(
  id: string,
  action: "discard" | "restore",
  who: string
): Promise<{ ok: boolean; error?: string }> {
  const [d] = await rows(sql`SELECT status, registry_item_id FROM listing_drafts WHERE id = ${id}`);
  if (!d) return { ok: false, error: "Draft not found" };
  if (action === "discard") {
    if (String(d.status) === "approved") return { ok: false, error: "Already approved — un-approve it first" };
    // A published draft is only a record of the live listing: removing it
    // from the queue hides the card and touches nothing on any venue.
    const note = String(d.status) === "published" ? "removed (published)" : `discarded by ${who}`;
    await db.execute(sql`UPDATE listing_drafts SET status = 'discarded', review_note = ${note}, updated_at = now() WHERE id = ${id}`);
    if (d.registry_item_id) {
      await db.execute(sql`UPDATE registry_items SET status = 'archived', updated_at = now() WHERE id = ${String(d.registry_item_id)} AND status = 'draft'`);
    }
  } else {
    if (String(d.status) !== "discarded") return { ok: false, error: "Not discarded" };
    await db.execute(sql`
      UPDATE listing_drafts SET status = CASE WHEN review_note = 'removed (published)' THEN 'published'
                                              WHEN EXISTS (SELECT 1 FROM draft_photos p WHERE p.draft_id = ${id} AND p.uploaded_at IS NULL)
                                              THEN 'uploading' ELSE 'ready' END,
             review_note = NULL, updated_at = now() WHERE id = ${id}`);
    if (d.registry_item_id) {
      await db.execute(sql`UPDATE registry_items SET status = 'draft', updated_at = now() WHERE id = ${String(d.registry_item_id)} AND status = 'archived'`);
    }
  }
  return { ok: true };
}

/** The next draft waiting for review after this one (oldest first, wrapping
 *  around), for "next to review" on the draft page. */
export async function nextReviewId(currentId: string): Promise<{ id: string | null; left: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(currentId)) return { id: null, left: 0 };
  const [r] = await rows(sql`
    WITH cur AS (SELECT created_at FROM listing_drafts WHERE id = ${currentId})
    SELECT
      (SELECT d.id FROM listing_drafts d, cur WHERE d.status = 'review' AND d.id <> ${currentId}
         ORDER BY (d.created_at <= cur.created_at), d.created_at LIMIT 1) AS next_id,
      (SELECT count(*)::int FROM listing_drafts d WHERE d.status = 'review' AND d.id <> ${currentId}) AS left`);
  return { id: r?.next_id ? String(r.next_id) : null, left: Number(r?.left ?? 0) };
}

/** The lowest .87 price at or above `min` (5 → 5.87, 5.87 → 5.87, 6 → 6.87). */
export function up87(min: number): number {
  const base = Math.floor(min) + 0.87;
  return Math.round((base >= min - 1e-9 ? base : base + 1) * 100) / 100;
}

/** Bulk "minimum price": every chosen editable draft priced below the
 *  minimum (or with no price) goes up to it. Poshmark's own price is kept
 *  only while it's still needed (eBay price under the Poshmark floor). */
export async function raiseMinPrice(
  ids: string[],
  min: number,
  opts: { round87: boolean; poshmarkFloor: number }
): Promise<{ raised: number; alreadyAbove: number; skipped: number; price: number }> {
  const clean = Array.from(new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))).slice(0, 500);
  if (!(min > 0) || min > 100000) throw new Error("Give a minimum price above $0");
  const price = opts.round87 ? up87(min) : Math.round(min * 100) / 100;
  if (!clean.length) return { raised: 0, alreadyAbove: 0, skipped: 0, price };
  const list = sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `);
  const editable = sql.join(EDITABLE_STATUS_LIST.map((st) => sql`${st}`), sql`, `);
  const raised = await rows(sql`
    UPDATE listing_drafts SET price = ${price},
      venue_prices = CASE WHEN ${price}::numeric >= ${opts.poshmarkFloor}::numeric
                          THEN NULLIF(COALESCE(venue_prices, '{}'::jsonb) - 'poshmark', '{}'::jsonb)
                          ELSE venue_prices END,
      written_by = CASE WHEN written_by IS NULL OR written_by = 'hand' THEN 'hand'
                        WHEN written_by LIKE 'claude%' THEN 'claude+hand' ELSE 'ai+hand' END,
      updated_at = now()
    WHERE id IN (${list}) AND status IN (${editable}) AND (price IS NULL OR price < ${price})
    RETURNING id`);
  const [c] = await rows(sql`
    SELECT count(*) FILTER (WHERE status IN (${editable}))::int AS editable FROM listing_drafts WHERE id IN (${list})`);
  const editableCount = Number(c?.editable ?? 0);
  return { raised: raised.length, alreadyAbove: editableCount - raised.length, skipped: clean.length - editableCount, price };
}
