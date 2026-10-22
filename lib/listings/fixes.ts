// Fix requests (FIX-1): after Claude has written drafts and before Todd
// approves them, he can ask Claude to fix one draft or a whole batch with a
// note ("It's 1952, not 1925", "all of these are linen, not chrome"). The
// draft stays in Review but can't be approved until Claude is done; Claude
// sees the request first in its queue, changes only what the note asks
// (text, price, specifics, category, shelves, photos, bin / quantity /
// weight / shipping), and finishes with a one-line summary. Todd then sees
// what changed and accepts or undoes it — `before` is the draft as it was
// when he asked.

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FIX_TOPICS = ["title", "description", "price", "specifics", "category", "condition", "photos", "sku/bin", "weight/shipping", "other"] as const;
/** Drafts a fix can be asked for: written, not yet listed anywhere. */
export const FIXABLE = ["review", "sent_back", "approved"];

export async function fixesReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.listing_fixes') IS NOT NULL AS ok`);
  return !!r?.ok;
}

// ─── snapshots ──────────────────────────────────────────────────────────────

const FIELDS = [
  "title", "description", "condition", "condition_note", "ebay_category_id", "ebay_category_name",
  "store_category_ids", "item_specifics", "price", "bin_sku", "quantity", "weight_oz", "shipping_profile",
  "venue_prices", "written_by",
] as const;
export type Snapshot = { fields: Record<string, unknown>; photos: Row[] };

async function snapshot(draftId: string): Promise<Snapshot> {
  const [d] = await rows(sql`SELECT * FROM listing_drafts WHERE id = ${draftId}::uuid`);
  const fields: Record<string, unknown> = {};
  for (const f of FIELDS) fields[f] = d?.[f] ?? null;
  const photos = await rows(sql`
    SELECT id, position, role, storage_key, url, original_name, sha256, bytes, content_type, uploaded_at, rotation, original_url
    FROM draft_photos WHERE draft_id = ${draftId}::uuid ORDER BY position`);
  return { fields, photos };
}

// ─── Todd: ask, cancel, accept, undo ────────────────────────────────────────

export async function requestFixes(
  ids: string[],
  note: string,
  topics: string[],
  who: string
): Promise<{ requested: string[]; skipped: Array<{ id: string; reason: string }> }> {
  const text = String(note ?? "").trim().slice(0, 4000);
  if (!text) throw new Error("Say what needs fixing.");
  const clean = Array.from(new Set(ids.filter((x) => UUID.test(x)))).slice(0, 200);
  if (!clean.length) throw new Error("Pick at least one draft.");
  const tps = Array.from(new Set(topics.filter((t) => (FIX_TOPICS as readonly string[]).includes(t))));
  const found = await rows(sql`
    SELECT id, status, title FROM listing_drafts WHERE id IN (${sql.join(clean.map((x) => sql`${x}::uuid`), sql`, `)})`);
  const byId = new Map(found.map((r) => [String(r.id), r]));
  const groupId = clean.length > 1 ? crypto.randomUUID() : null;
  const out = { requested: [] as string[], skipped: [] as Array<{ id: string; reason: string }> };
  for (const id of clean) {
    const d = byId.get(id);
    if (!d) {
      out.skipped.push({ id, reason: "not found" });
      continue;
    }
    if (!FIXABLE.includes(String(d.status)) || !d.title) {
      out.skipped.push({ id, reason: d.title ? `it's ${String(d.status).replace("_", " ")}` : "not written yet" });
      continue;
    }
    if (String(d.status) === "approved") {
      // Back to Review while Claude fixes it.
      await db.execute(sql`UPDATE listing_drafts SET status = 'review', approved_at = NULL, approved_by = NULL, updated_at = now()
        WHERE id = ${id}::uuid AND status = 'approved'`);
    }
    const before = await snapshot(id);
    await db.execute(sql`
      INSERT INTO listing_fixes (draft_id, group_id, note, topics, before, created_by)
      VALUES (${id}::uuid, ${groupId}::uuid, ${text}, ${`{${tps.map((t) => `"${t}"`).join(",")}}`}::text[], ${JSON.stringify(before)}::jsonb, ${who})`);
    out.requested.push(id);
  }
  return out;
}

export async function cancelFix(fixId: string): Promise<void> {
  if (!UUID.test(fixId)) throw new Error("Bad id");
  await db.execute(sql`UPDATE listing_fixes SET status = 'cancelled', resolved_at = now() WHERE id = ${fixId}::uuid AND status = 'open'`);
}

export async function acceptFix(fixId: string): Promise<void> {
  if (!UUID.test(fixId)) throw new Error("Bad id");
  await db.execute(sql`UPDATE listing_fixes SET status = 'accepted', resolved_at = now() WHERE id = ${fixId}::uuid AND status = 'done'`);
}

/** Put the draft back the way it was when Todd asked (text, price, details
 *  and photos). Only the latest fix on a draft can be undone. */
export async function undoFix(fixId: string): Promise<void> {
  if (!UUID.test(fixId)) throw new Error("Bad id");
  const [f] = await rows(sql`SELECT * FROM listing_fixes WHERE id = ${fixId}::uuid`);
  if (!f || !["done", "accepted"].includes(String(f.status))) throw new Error("Only a finished fix can be undone.");
  const [later] = await rows(sql`
    SELECT 1 AS x FROM listing_fixes WHERE draft_id = ${String(f.draft_id)}::uuid
      AND created_at > (SELECT created_at FROM listing_fixes WHERE id = ${fixId}::uuid)
      AND status IN ('open', 'done', 'accepted') LIMIT 1`);
  if (later) throw new Error("A later fix on this draft has to be undone (or cancelled) first.");
  const [d] = await rows(sql`SELECT status FROM listing_drafts WHERE id = ${String(f.draft_id)}::uuid`);
  if (!d || !["review", "sent_back"].includes(String(d.status))) throw new Error(`The draft is ${String(d?.status ?? "gone")} now; undo it from Review only.`);
  const snap = f.before as Snapshot;
  const v = snap.fields;
  await db.execute(sql`
    UPDATE listing_drafts SET
      title = ${v.title as string | null}, description = ${v.description as string | null}, condition = ${v.condition as string | null},
      condition_note = ${v.condition_note as string | null}, ebay_category_id = ${v.ebay_category_id as string | null},
      ebay_category_name = ${v.ebay_category_name as string | null},
      store_category_ids = ${v.store_category_ids == null ? null : JSON.stringify(v.store_category_ids)}::jsonb,
      item_specifics = ${v.item_specifics == null ? null : JSON.stringify(v.item_specifics)}::jsonb,
      price = ${v.price as string | null}, bin_sku = ${v.bin_sku as string | null}, quantity = ${(v.quantity as number | null) ?? 1},
      weight_oz = ${v.weight_oz as string | null}, shipping_profile = ${v.shipping_profile as string | null},
      venue_prices = ${v.venue_prices == null ? null : JSON.stringify(v.venue_prices)}::jsonb,
      written_by = ${v.written_by as string | null}, updated_at = now()
    WHERE id = ${String(f.draft_id)}::uuid`);
  // Photos: put every row back (re-adding any Claude removed).
  const draftId = String(f.draft_id);
  const cur = await rows(sql`SELECT id FROM draft_photos WHERE draft_id = ${draftId}::uuid`);
  const curIds = new Set(cur.map((r) => String(r.id)));
  const snapIds = new Set(snap.photos.map((p) => String(p.id)));
  for (const [i, p] of snap.photos.entries()) {
    if (curIds.has(String(p.id))) await db.execute(sql`UPDATE draft_photos SET position = ${-200000 - i} WHERE id = ${String(p.id)}::uuid`);
  }
  // Photos added since (none expected) step aside past the end.
  let extra = 5000;
  for (const id of curIds) if (!snapIds.has(id)) await db.execute(sql`UPDATE draft_photos SET position = ${extra++} WHERE id = ${id}::uuid`);
  for (const p of snap.photos) {
    if (curIds.has(String(p.id))) {
      await db.execute(sql`UPDATE draft_photos SET position = ${Number(p.position)}, url = ${String(p.url)},
        rotation = ${Number(p.rotation ?? 0)}, original_url = ${(p.original_url as string | null) ?? null} WHERE id = ${String(p.id)}::uuid`);
    } else {
      await db.execute(sql`
        INSERT INTO draft_photos (id, draft_id, position, role, storage_key, url, original_name, sha256, bytes, content_type, uploaded_at, rotation, original_url)
        VALUES (${String(p.id)}::uuid, ${draftId}::uuid, ${Number(p.position)}, ${(p.role as string | null) ?? null}, ${String(p.storage_key)},
                ${String(p.url)}, ${(p.original_name as string | null) ?? null}, ${(p.sha256 as string | null) ?? null},
                ${p.bytes == null ? null : Number(p.bytes)}, ${String(p.content_type)}, ${p.uploaded_at ? String(p.uploaded_at) : null}::timestamp,
                ${Number(p.rotation ?? 0)}, ${(p.original_url as string | null) ?? null})
        ON CONFLICT (storage_key) DO NOTHING`);
    }
  }
  await db.execute(sql`UPDATE listing_fixes SET status = 'undone', resolved_at = now() WHERE id = ${fixId}::uuid`);
}

// ─── reading ────────────────────────────────────────────────────────────────

export type FixView = {
  id: string;
  groupId: string | null;
  groupSize: number;
  note: string;
  topics: string[];
  status: string;
  summary: string | null;
  createdAt: string;
  doneAt: string | null;
  changes: FieldChange[];
};
export type FieldChange = { field: string; before: string; after: string };

const LABEL: Record<string, string> = {
  title: "Title", description: "Description", condition: "Condition", condition_note: "Condition note",
  ebay_category_name: "eBay category", store_category_ids: "Store shelves", item_specifics: "Item specifics",
  price: "Price", bin_sku: "Bin / SKU", quantity: "Quantity", weight_oz: "Weight (oz)", shipping_profile: "Shipping profile",
};

const show = (v: unknown): string => {
  if (v == null || v === "") return "—";
  if (typeof v === "object") {
    if (Array.isArray(v)) return v.join(", ");
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(" | ") : String(x)}`)
      .join("; ");
  }
  return String(v);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || show(a) === show(b);

/** Pure: what changed between the snapshot and the draft now. */
export function diffSnapshot(before: Snapshot, nowFields: Record<string, unknown>, nowPhotos: Row[]): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of Object.keys(LABEL)) {
    const a = before.fields[f];
    const b = nowFields[f];
    if (f === "price" ? Number(a ?? NaN) === Number(b ?? NaN) || (a == null && b == null) : same(a, b)) continue;
    out.push({ field: LABEL[f], before: show(a), after: show(b) });
  }
  const ord = (ps: Row[]) => ps.map((p) => `${String(p.id)}@${Number(p.rotation ?? 0)}`).join(",");
  const beforeIds = before.photos.map((p) => String(p.id));
  const nowIds = nowPhotos.map((p) => String(p.id));
  if (ord(before.photos) !== ord(nowPhotos)) {
    const removed = beforeIds.filter((x) => !nowIds.includes(x)).length;
    const turned = nowPhotos.filter((p) => {
      const b = before.photos.find((x) => String(x.id) === String(p.id));
      return b && Number(b.rotation ?? 0) !== Number(p.rotation ?? 0);
    }).length;
    const kept = beforeIds.filter((x) => nowIds.includes(x));
    const reordered = kept.join(",") !== nowIds.filter((x) => kept.includes(x)).join(",");
    const bits = [reordered ? "reordered" : "", turned ? `${turned} turned` : "", removed ? `${removed} removed` : ""].filter(Boolean);
    out.push({ field: "Photos", before: `${beforeIds.length} photos`, after: bits.join(", ") || "changed" });
  }
  return out;
}

export async function fixesForDraft(draftId: string): Promise<FixView[]> {
  if (!UUID.test(draftId) || !(await fixesReady())) return [];
  const list = await rows(sql`
    SELECT f.*, (SELECT count(*)::int FROM listing_fixes g WHERE g.group_id = f.group_id) AS group_size
    FROM listing_fixes f WHERE f.draft_id = ${draftId}::uuid ORDER BY f.created_at DESC LIMIT 20`);
  if (!list.length) return [];
  const [d] = await rows(sql`SELECT * FROM listing_drafts WHERE id = ${draftId}::uuid`);
  const nowPhotos = await rows(sql`SELECT id, position, rotation FROM draft_photos WHERE draft_id = ${draftId}::uuid ORDER BY position`);
  const nowFields: Record<string, unknown> = {};
  for (const f of FIELDS) nowFields[f] = d?.[f] ?? null;
  return list.map((f) => ({
    id: String(f.id),
    groupId: f.group_id ? String(f.group_id) : null,
    groupSize: Number(f.group_size ?? 1) || 1,
    note: String(f.note),
    topics: Array.isArray(f.topics) ? (f.topics as string[]) : [],
    status: String(f.status),
    summary: (f.summary as string | null) ?? null,
    createdAt: String(f.created_at),
    doneAt: f.done_at ? String(f.done_at) : null,
    changes: ["done", "accepted"].includes(String(f.status)) ? diffSnapshot(f.before as Snapshot, nowFields, nowPhotos) : [],
  }));
}

export async function hasOpenFix(draftId: string): Promise<boolean> {
  if (!(await fixesReady().catch(() => false))) return false;
  const [r] = await rows(sql`SELECT 1 AS x FROM listing_fixes WHERE draft_id = ${draftId}::uuid AND status = 'open' LIMIT 1`);
  return !!r;
}

export async function fixCounts(): Promise<{ open: number; done: number }> {
  if (!(await fixesReady().catch(() => false))) return { open: 0, done: 0 };
  const [r] = await rows(sql`
    SELECT count(DISTINCT draft_id) FILTER (WHERE status = 'open')::int AS open,
           count(DISTINCT draft_id) FILTER (WHERE status = 'done')::int AS done
    FROM listing_fixes`);
  return { open: Number(r?.open ?? 0), done: Number(r?.done ?? 0) };
}

// ─── Claude ─────────────────────────────────────────────────────────────────

/** Open fix requests, one entry per request (a batch note lists all its
 *  drafts once). */
export async function fixQueue() {
  if (!(await fixesReady().catch(() => false))) return [];
  const list = await rows(sql`
    SELECT f.id, f.draft_id, f.group_id, f.note, f.topics, f.created_at, d.title
    FROM listing_fixes f JOIN listing_drafts d ON d.id = f.draft_id
    WHERE f.status = 'open' ORDER BY f.created_at`);
  const groups = new Map<string, { note: string; topics: string[]; asked: string; drafts: Array<{ draftId: string; fixId: string; title: string }> }>();
  for (const r of list) {
    const key = r.group_id ? `g:${r.group_id}` : `f:${r.id}`;
    const g = groups.get(key) ?? { note: String(r.note), topics: (r.topics as string[]) ?? [], asked: String(r.created_at), drafts: [] };
    g.drafts.push({ draftId: String(r.draft_id), fixId: String(r.id), title: String(r.title ?? "") });
    groups.set(key, g);
  }
  return Array.from(groups.values());
}

export async function openFixNotes(draftId: string): Promise<Array<{ note: string; topics: string[]; batch: number }>> {
  if (!(await fixesReady().catch(() => false))) return [];
  const list = await rows(sql`
    SELECT f.note, f.topics, (SELECT count(*)::int FROM listing_fixes g WHERE g.group_id = f.group_id) AS n
    FROM listing_fixes f WHERE f.draft_id = ${draftId}::uuid AND f.status = 'open' ORDER BY f.created_at`);
  return list.map((r) => ({ note: String(r.note), topics: (r.topics as string[]) ?? [], batch: Number(r.n ?? 1) || 1 }));
}

/** Claude finishes the open fixes on a draft with what it changed. */
export async function completeFixes(draftId: string, summary: string, who: string): Promise<number> {
  if (!UUID.test(draftId)) throw new Error("draft_id must be a draft id");
  const text = String(summary ?? "").trim().slice(0, 1000);
  if (!text) throw new Error("Give Todd a one-line summary of what you changed (or why nothing needed to change).");
  const done = await rows(sql`
    UPDATE listing_fixes SET status = 'done', summary = ${text}, done_at = now(), done_by = ${who}
    WHERE draft_id = ${draftId}::uuid AND status = 'open' RETURNING id`);
  if (!done.length) throw new Error("That draft has no open fix request.");
  await db.execute(sql`UPDATE listing_drafts SET status = 'review', updated_at = now() WHERE id = ${draftId}::uuid AND status = 'sent_back'`);
  return done.length;
}

/** Photos, for a draft with an open fix: new order (positions as they are
 *  now, in the order wanted), turns, and photos to take off. */
export async function fixPhotos(
  draftId: string,
  opts: { order?: number[]; rotate?: Array<{ position: number; turn: number }>; remove?: number[] }
): Promise<{ photos: number; note: string }> {
  if (!(await hasOpenFix(draftId))) throw new Error("Photos can only be changed here for a draft Todd asked you to fix.");
  const { rotatePhoto } = await import("./photos");
  const { placePhotos } = await import("./lots");
  for (const r of opts.rotate ?? []) {
    const turn = Number(r.turn);
    if (![90, -90, 180, 270].includes(turn)) throw new Error("turn must be 90 (clockwise), -90 (counter-clockwise) or 180");
    await rotatePhoto(draftId, Number(r.position), (turn === 270 ? -90 : turn) as 90 | -90 | 180);
  }
  let list = await rows(sql`SELECT id, position FROM draft_photos WHERE draft_id = ${draftId}::uuid AND uploaded_at IS NOT NULL ORDER BY position`);
  const remove = new Set((opts.remove ?? []).map(Number));
  if (remove.size) {
    if (remove.size >= list.length) throw new Error("A draft needs at least one photo.");
    for (const p of list) if (remove.has(Number(p.position))) await db.execute(sql`DELETE FROM draft_photos WHERE id = ${String(p.id)}::uuid`);
    list = list.filter((p) => !remove.has(Number(p.position)));
  }
  let ordered = list;
  if (opts.order?.length) {
    const byPos = new Map(list.map((p) => [Number(p.position), p]));
    const picked = opts.order.map(Number).filter((n) => byPos.has(n));
    const seen = new Set(picked);
    ordered = [...picked.map((n) => byPos.get(n)!), ...list.filter((p) => !seen.has(Number(p.position)))];
  }
  await placePhotos(ordered.map((p, i) => ({ id: String(p.id), draftId, position: i + 1 })));
  await db.execute(sql`UPDATE listing_drafts SET updated_at = now() WHERE id = ${draftId}::uuid`);
  return { photos: ordered.length, note: "Photos updated (positions are now 1…" + ordered.length + "). Call listing_get_draft to see them if you need to." };
}
