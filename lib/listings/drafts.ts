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
  "discarded",
] as const;

export type DraftPhoto = {
  position: number;
  role: string | null;
  url: string;
  uploaded: boolean;
  name: string | null;
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
};

export type Draft = DraftSummary & {
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
    })),
  };
}

export async function loadDraft(id: string): Promise<Draft | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [d] = await rows(sql`SELECT * FROM listing_drafts WHERE id = ${id}`);
  if (!d) return null;
  const photos = await rows(sql`
    SELECT position, role, url, uploaded_at, original_name FROM draft_photos WHERE draft_id = ${id} ORDER BY position`);
  const photoList = photos.map((p) => ({
    position: Number(p.position),
    role: s(p.role),
    url: String(p.url),
    uploaded: p.uploaded_at != null,
    name: s(p.original_name),
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

const EDITABLE_STATUSES = new Set(["uploading", "ready", "review", "sent_back"]);

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
  sets.push(sql`written_by = CASE WHEN written_by IS NULL OR written_by = 'hand' THEN 'hand' ELSE 'ai+hand' END`);
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
