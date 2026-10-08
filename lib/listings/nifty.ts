// Nifty bridge, FIA side (Phase LIST-3).
//
// Approved drafts are handed to the "Send approved to Nifty" button in the
// FIA Nifty Sync Chrome extension, which creates each one as a Nifty DRAFT
// (inventory.saveAsDraftV2) from Todd's signed-in Nifty tab — no "Generate",
// no credits, nothing published. Nifty's fixed per-marketplace settings
// (shipping, returns, payment, Mercari/Depop/Whatnot shipping, Poshmark size,
// venue categories) are copied from a TEMPLATE item: an existing Nifty
// listing of the same kind.
//
// This module: the template map (app_settings "niftyTemplates"), which
// template a draft uses, the queue the extension reads, and recording what
// came back.

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export const TEMPLATE_KEYS = [
  "postcard",
  "photo",
  "paper_envelope",
  "paper_calculated",
  "book",
  "media",
  "general",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  postcard: "Postcards (Standard Envelope)",
  photo: "Photos / RPPC (Standard Envelope)",
  paper_envelope: "Small paper & ephemera (Standard Envelope)",
  paper_calculated: "Larger paper & ephemera (calculated shipping)",
  book: "Books (Media Mail)",
  media: "Records, CDs, DVDs, tapes (Media Mail)",
  general: "Everything else (calculated shipping)",
};

/** Picked Oct 8 2026 from live listings that are on all five venues. */
export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  postcard: "16ac8099-ee60-460d-9f15-db1495288754", // Marbledge, East Dorset VT postcard
  photo: "9a006a95-586d-470d-8cf6-c27c3d8ca1f0", // RPPC baby studio portrait
  paper_envelope: "cc781110-9437-44f9-bd3e-e3ca96b3bcf9", // 1938 valentine card
  paper_calculated: "2da6b784-370b-4208-a884-5c90f954162f", // 1947 St Bernard church bulletin
  book: "eb6cbd53-5502-422a-9852-a8a54d7768b9", // Ohatchee community cookbook
  media: "aa70009c-768e-4f4c-9b8f-35e8986cb005", // Jerry Reed 45
  general: "4bd099e6-b941-45ca-8f58-a75a4999287a", // 1976 Exxon bicentennial piece
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts a Nifty item id or an app.nifty.ai/inventory/edit/<id> link. */
export function niftyIdFrom(v: unknown): string | null {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(v ?? ""));
  return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
}

export function parseTemplates(raw: unknown): Record<TemplateKey, string> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_TEMPLATES };
  for (const k of TEMPLATE_KEYS) {
    const id = niftyIdFrom(r[k]);
    if (id) out[k] = id;
  }
  return out;
}

export async function niftyTemplates(): Promise<Record<TemplateKey, string>> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = 'niftyTemplates'`);
  return parseTemplates(r?.value ?? null);
}

export async function saveNiftyTemplates(raw: unknown): Promise<Record<TemplateKey, string>> {
  const t = parseTemplates(raw);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('niftyTemplates', ${JSON.stringify(t)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  return t;
}

/** Which template fits a draft: by what the item is, then how it ships. */
export function pickTemplateKey(i: { kind?: string | null; categoryPath?: string | null; shippingProfile?: string | null; title?: string | null }): TemplateKey {
  const kind = (i.kind ?? "").toLowerCase();
  const path = (i.categoryPath ?? "").toLowerCase();
  const title = (i.title ?? "").toLowerCase();
  const ship = (i.shippingProfile ?? "").toLowerCase();
  if (kind === "book" || kind === "magazine" || /^books/.test(path)) return "book";
  if (kind === "record" || /^(music|movies)/.test(path)) return "media";
  if (kind === "postcard" || /postcard/.test(path)) {
    return /\brppc\b|real photo/.test(title) ? "photo" : "postcard";
  }
  if (kind === "photograph" || /photographic images/.test(path)) return ship === "envelope" ? "photo" : "paper_calculated";
  if (["ephemera", "greeting_card", "map", "document", "trading_card"].includes(kind) || /collectibles > paper/.test(path)) {
    return ship === "envelope" ? "paper_envelope" : "paper_calculated";
  }
  if (ship === "envelope") return "paper_envelope";
  return "general";
}

export type NiftyQueueItem = {
  draftId: string;
  templateKey: TemplateKey;
  templateId: string;
  title: string;
  description: string;
  condition: string;
  conditionNote: string | null;
  price: number;
  venuePrices: Record<string, number> | null;
  quantity: number;
  sku: string | null;
  privateNotes: string;
  photos: string[];
  ebayCategoryPath: string | null;
  itemSpecifics: Record<string, string | string[]>;
  storeCategoryIds: string[];
};

/** Approved drafts not yet in Nifty, oldest first. */
export async function niftyQueue(limit = 25): Promise<NiftyQueueItem[]> {
  const templates = await niftyTemplates();
  const found = await rows(sql`
    SELECT d.*, (SELECT json_agg(p.url ORDER BY p.position) FROM draft_photos p
                 WHERE p.draft_id = d.id AND p.uploaded_at IS NOT NULL) AS photo_urls
    FROM listing_drafts d
    WHERE d.status = 'approved' AND d.nifty_item_id IS NULL
    ORDER BY d.approved_at NULLS LAST, d.created_at
    LIMIT ${limit}`);
  return found.map((d) => {
    const meta = (d.ai_meta ?? {}) as Record<string, unknown>;
    const ident = (meta.identification ?? {}) as Record<string, unknown>;
    const key = pickTemplateKey({
      kind: ident.kind as string | undefined,
      categoryPath: d.ebay_category_name as string | null,
      shippingProfile: d.shipping_profile as string | null,
      title: d.title as string | null,
    });
    const id8 = String(d.id).slice(0, 8);
    return {
      draftId: String(d.id),
      templateKey: key,
      templateId: templates[key],
      title: String(d.title ?? ""),
      description: String(d.description ?? ""),
      condition: String(d.condition ?? "Used"),
      conditionNote: (d.condition_note as string | null) ?? null,
      price: Number(d.price),
      venuePrices: (d.venue_prices as Record<string, number> | null) ?? null,
      quantity: Number(d.quantity ?? 1),
      sku: (d.bin_sku as string | null) ?? null,
      privateNotes: `FIA ${id8}${d.bin_sku ? ` | SKU: ${d.bin_sku}` : ""}`,
      photos: ((d.photo_urls as string[] | null) ?? []).slice(0, 24),
      ebayCategoryPath: (d.ebay_category_name as string | null) ?? null,
      itemSpecifics: (d.item_specifics as Record<string, string | string[]> | null) ?? {},
      storeCategoryIds: (d.store_category_ids as string[] | null) ?? [],
    };
  });
}

/** What the extension reports back for one draft. */
export async function recordNiftyResult(
  draftId: string,
  r: { niftyId?: string | null; warnings?: string[]; error?: string | null }
): Promise<{ ok: boolean; error?: string }> {
  const warnings = (r.warnings ?? []).map((w) => String(w).slice(0, 300)).slice(0, 40);
  const niftyId = niftyIdFrom(r.niftyId);
  if (niftyId) {
    const done = await rows(sql`
      UPDATE listing_drafts SET status = 'in_nifty', nifty_item_id = ${niftyId}, nifty_sent_at = now(),
             nifty_error = NULL, nifty_warnings = ${JSON.stringify(warnings)}::jsonb, updated_at = now()
      WHERE id = ${draftId} AND status = 'approved' AND nifty_item_id IS NULL RETURNING registry_item_id`);
    if (!done.length) return { ok: false, error: "Draft isn't approved-and-unsent any more" };
    // Link the registry item to its Nifty record (Phase 1 registry).
    const reg = done[0].registry_item_id;
    if (reg) {
      await db.execute(sql`
        UPDATE registry_items SET nifty_id = COALESCE(nifty_id, ${niftyId}), updated_at = now()
        WHERE id = ${String(reg)}`).catch(() => undefined);
    }
    return { ok: true };
  }
  const msg = String(r.error ?? "No Nifty id came back").slice(0, 1500);
  await db.execute(sql`
    UPDATE listing_drafts SET nifty_error = ${msg}, nifty_warnings = ${JSON.stringify(warnings)}::jsonb, updated_at = now()
    WHERE id = ${draftId}`);
  return { ok: true };
}
