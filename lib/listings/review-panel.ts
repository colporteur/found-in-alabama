// Review panel (PANEL-1, extended PANEL-2): the data and actions behind the
// panel the FIA connector opens beside a Claude chat
// (lib/mcp/review-panel-tools.ts). It lists the drafts Claude wrote that are
// waiting in Todd's Review queue, each with its text, photos, flags, the words
// Claude wasn't sure of, what it still needs before approval, and any fix
// request with what the fix changed.
//
// The actions here are the ones Todd already has in the FIA admin, reached
// from the panel: ask for a fix (requestFixes), accept or undo a finished fix,
// keep or remove an unverified word (decideUnverified), edit the title or
// price by hand (updateDraft), and turn or reorder photos. Approving is not
// here; it stays in the admin.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { approvalGaps } from "./review";
import { fixesForDraft, fixesReady, hasOpenFix, type FieldChange } from "./fixes";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses the panel shows and may change. */
const IN_REVIEW = ["review", "sent_back"];

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
  /** Confident words the item doesn't show; `index` is what decideUnverified takes. */
  unverified: Array<{ index: number; words: string; basis: string | null; decision: string | null }>;
  /** What it still needs before it can be approved (empty = ready). */
  needs: string[];
  photos: Array<{ position: number; url: string }>;
  /** A lot's photos are arranged by FIA (cover, merged scans), so the panel leaves them alone. */
  isLot: boolean;
  /** A fix Todd asked for that Claude hasn't finished. */
  openFix: string | null;
  /** A fix Claude finished that Todd hasn't accepted or undone yet. */
  doneFix: { id: string; note: string; summary: string | null; changes: FieldChange[] } | null;
};

export type ReviewPanelData = { total: number; drafts: PanelDraft[] };

const COLUMNS = sql`
  id, title, description, price, condition, condition_note, status, bin_sku, ebay_category_name,
  written_by, updated_at, ai_meta->'flags' AS flags, ai_meta->'unverified' AS unverified,
  (ai_meta ? 'lot' OR ai_meta ? 'photoFit' OR ai_meta ? 'folderLot') AS lot_meta`;

async function build(list: Row[]): Promise<PanelDraft[]> {
  if (!list.length) return [];
  const idList = sql.join(list.map((r) => sql`${String(r.id)}::uuid`), sql`, `);
  const photoRows = await rows(sql`
    SELECT draft_id, position, url, role FROM draft_photos
    WHERE draft_id IN (${idList}) AND uploaded_at IS NOT NULL AND url IS NOT NULL
    ORDER BY draft_id, position`);
  const photos = new Map<string, Array<{ position: number; url: string }>>();
  const hasCover = new Set<string>();
  for (const p of photoRows) {
    const k = String(p.draft_id);
    photos.set(k, [...(photos.get(k) ?? []), { position: Number(p.position), url: String(p.url) }]);
    if (String(p.role ?? "") === "cover") hasCover.add(k);
  }

  const open = new Map<string, string>();
  const withDone = new Set<string>();
  if (await fixesReady().catch(() => false)) {
    const fixRows = await rows(sql`
      SELECT draft_id, status, note FROM listing_fixes
      WHERE draft_id IN (${idList}) AND status IN ('open', 'done')
      ORDER BY created_at`);
    for (const f of fixRows) {
      const k = String(f.draft_id);
      if (String(f.status) === "open") open.set(k, String(f.note ?? ""));
      else withDone.add(k);
    }
  }

  const out: PanelDraft[] = [];
  for (const r of list) {
    const id = String(r.id);
    const ph = photos.get(id) ?? [];
    let doneFix: PanelDraft["doneFix"] = null;
    if (withDone.has(id) && !open.has(id)) {
      // Newest first; the latest finished fix is the one that can be undone.
      const f = (await fixesForDraft(id)).find((x) => x.status === "done");
      if (f) doneFix = { id: f.id, note: f.note, summary: f.summary, changes: f.changes };
    }
    const unv = Array.isArray(r.unverified) ? (r.unverified as Array<Record<string, unknown>>) : [];
    out.push({
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
      unverified: unv
        .map((u, index) => ({ index, words: String(u?.words ?? ""), basis: str(u?.basis), decision: str(u?.decision) }))
        .filter((u) => u.words),
      needs: approvalGaps({ title: r.title, description: r.description, price: r.price, condition: r.condition, photos: ph.length }),
      photos: ph,
      isLot: !!r.lot_meta || hasCover.has(id),
      openFix: open.get(id) ?? null,
      doneFix,
    });
  }
  return out;
}

export async function reviewPanelData(limit = 12): Promise<ReviewPanelData> {
  const n = Math.max(1, Math.min(24, Math.round(limit) || 12));
  const where = sql`status IN ('review', 'sent_back') AND written_by LIKE 'claude%'`;
  const [count] = await rows(sql`SELECT count(*)::int AS n FROM listing_drafts WHERE ${where}`);
  const list = await rows(sql`
    SELECT ${COLUMNS} FROM listing_drafts WHERE ${where}
    ORDER BY updated_at DESC LIMIT ${n}`);
  return { total: Number(count?.n ?? list.length), drafts: await build(list) };
}

/** One draft, as the panel shows it (to redraw a card after an action).
 *  null when it has left Review (approved, discarded, taken back). */
export async function reviewPanelDraft(id: string): Promise<PanelDraft | null> {
  if (!UUID.test(id)) return null;
  const list = await rows(sql`
    SELECT ${COLUMNS} FROM listing_drafts
    WHERE id = ${id}::uuid AND status IN ('review', 'sent_back')`);
  return (await build(list))[0] ?? null;
}

/** Turn one photo, or put the photos in a new order, from the panel.
 *  `order` lists current positions in the order wanted; any left out keep
 *  their order after them. Lots are refused: FIA arranges their photos. */
export async function panelPhotoChange(
  draftId: string,
  opts: { rotate?: { position: number; turn: number }; order?: number[] }
): Promise<void> {
  if (!UUID.test(draftId)) throw new Error("Bad draft id");
  const [d] = await rows(sql`
    SELECT status, (ai_meta ? 'lot' OR ai_meta ? 'photoFit' OR ai_meta ? 'folderLot') AS lot_meta,
      EXISTS (SELECT 1 FROM draft_photos p WHERE p.draft_id = listing_drafts.id AND p.role = 'cover') AS has_cover
    FROM listing_drafts WHERE id = ${draftId}::uuid`);
  if (!d) throw new Error("Draft not found");
  if (!IN_REVIEW.includes(String(d.status))) throw new Error(`This draft is ${String(d.status).replace("_", " ")} now; its photos can't be changed here.`);
  if (d.lot_meta || d.has_cover) throw new Error("FIA arranges a lot's photos. Change them on the draft page.");
  if (await hasOpenFix(draftId)) throw new Error("Claude is still working on a fix for this draft. Try again when it's done.");

  if (opts.rotate) {
    const turn = Number(opts.rotate.turn);
    if (![90, -90, 180].includes(turn)) throw new Error("turn must be 90, -90 or 180");
    const { rotatePhoto } = await import("./photos");
    await rotatePhoto(draftId, Number(opts.rotate.position), turn as 90 | -90 | 180);
    return;
  }
  if (opts.order?.length) {
    const list = await rows(sql`
      SELECT id, position FROM draft_photos
      WHERE draft_id = ${draftId}::uuid AND uploaded_at IS NOT NULL ORDER BY position`);
    const byPos = new Map(list.map((p) => [Number(p.position), p]));
    const picked = Array.from(new Set(opts.order.map(Number))).filter((n) => byPos.has(n));
    if (!picked.length) throw new Error("No such photos");
    const seen = new Set(picked);
    const ordered = [...picked.map((n) => byPos.get(n)!), ...list.filter((p) => !seen.has(Number(p.position)))];
    const { placePhotos } = await import("./lots");
    await placePhotos(ordered.map((p, i) => ({ id: String(p.id), draftId, position: i + 1 })));
    await db.execute(sql`UPDATE listing_drafts SET updated_at = now() WHERE id = ${draftId}::uuid`);
    return;
  }
  throw new Error("Nothing to change");
}
