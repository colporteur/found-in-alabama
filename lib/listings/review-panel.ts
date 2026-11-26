// Review panel (PANEL-1): the data behind the panel the FIA connector opens
// beside a Claude chat (lib/mcp/review-panel-tools.ts). It lists the drafts
// Claude wrote that are waiting in Todd's Review queue, each with its text,
// photos, flags, what it still needs before approval, and any fix request.
// Read-only: asking for a fix goes through requestFixes (lib/listings/fixes),
// and approving stays in the FIA admin.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { approvalGaps } from "./review";
import { fixesReady } from "./fixes";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const str = (v: unknown) => (v == null || v === "" ? null : String(v));

export type PanelDraft = {
  id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  condition: string | null;
  conditionNote: string | null;
  bin: string | null;
  category: string | null;
  status: string;
  editedByTodd: boolean;
  updated: string | null;
  flags: string[];
  /** What it still needs before it can be approved (empty = ready). */
  needs: string[];
  photos: Array<{ position: number; url: string }>;
  /** A fix Todd asked for that Claude hasn't finished. */
  openFix: string | null;
  /** A fix Claude finished that Todd hasn't accepted or undone yet. */
  doneFix: string | null;
};

export type ReviewPanelData = { total: number; drafts: PanelDraft[] };

export async function reviewPanelData(limit = 12): Promise<ReviewPanelData> {
  const n = Math.max(1, Math.min(24, Math.round(limit) || 12));
  const where = sql`status IN ('review', 'sent_back') AND written_by LIKE 'claude%'`;
  const [count] = await rows(sql`SELECT count(*)::int AS n FROM listing_drafts WHERE ${where}`);
  const list = await rows(sql`
    SELECT id, title, description, price, condition, condition_note, status, bin_sku,
           ebay_category_name, written_by, updated_at, ai_meta->'flags' AS flags
    FROM listing_drafts WHERE ${where}
    ORDER BY updated_at DESC LIMIT ${n}`);
  if (!list.length) return { total: Number(count?.n ?? 0), drafts: [] };

  const idList = sql.join(list.map((r) => sql`${String(r.id)}::uuid`), sql`, `);
  const photoRows = await rows(sql`
    SELECT draft_id, position, url FROM draft_photos
    WHERE draft_id IN (${idList}) AND uploaded_at IS NOT NULL AND url IS NOT NULL
    ORDER BY draft_id, position`);
  const photos = new Map<string, Array<{ position: number; url: string }>>();
  for (const p of photoRows) {
    const k = String(p.draft_id);
    photos.set(k, [...(photos.get(k) ?? []), { position: Number(p.position), url: String(p.url) }]);
  }

  const open = new Map<string, string>();
  const done = new Map<string, string>();
  if (await fixesReady().catch(() => false)) {
    const fixRows = await rows(sql`
      SELECT draft_id, status, note, summary FROM listing_fixes
      WHERE draft_id IN (${idList}) AND status IN ('open', 'done')
      ORDER BY created_at`);
    for (const f of fixRows) {
      const k = String(f.draft_id);
      if (String(f.status) === "open") open.set(k, String(f.note ?? ""));
      else done.set(k, String(f.summary ?? ""));
    }
  }

  return {
    total: Number(count?.n ?? list.length),
    drafts: list.map((r) => {
      const id = String(r.id);
      const ph = photos.get(id) ?? [];
      return {
        id,
        title: str(r.title),
        description: str(r.description),
        price: r.price == null ? null : Number(r.price),
        condition: str(r.condition),
        conditionNote: str(r.condition_note),
        bin: str(r.bin_sku),
        category: str(r.ebay_category_name),
        status: String(r.status),
        editedByTodd: String(r.written_by ?? "").includes("hand"),
        updated: iso(r.updated_at),
        flags: Array.isArray(r.flags) ? (r.flags as unknown[]).map(String) : [],
        needs: approvalGaps({ title: r.title, description: r.description, price: r.price, condition: r.condition, photos: ph.length }),
        photos: ph,
        openFix: open.get(id) ?? null,
        doneFix: open.has(id) ? null : done.get(id) ?? null,
      };
    }),
  };
}
