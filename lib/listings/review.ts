// Review actions for listing drafts (Phase LIST-2): approve (one or many),
// unapprove, send back. Approval only marks the draft; publishing to Nifty /
// eBay is a later milestone and never happens from here.

import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

/** What a draft still needs before it can be approved (empty = ready). */
export function approvalGaps(d: { title?: unknown; description?: unknown; price?: unknown; condition?: unknown }): string[] {
  const gaps: string[] = [];
  if (!d.title || String(d.title).trim().length < 10) gaps.push("title");
  if (!d.description || String(d.description).trim().length < 40) gaps.push("description");
  if (d.price == null || !(Number(d.price) > 0)) gaps.push("price");
  if (!d.condition) gaps.push("condition");
  return gaps;
}

export type ApproveResult = { approved: string[]; skipped: Array<{ id: string; reason: string }> };

export async function approveDrafts(ids: string[], who: string): Promise<ApproveResult> {
  const clean = Array.from(new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))).slice(0, 200);
  const out: ApproveResult = { approved: [], skipped: [] };
  if (clean.length === 0) return out;
  const found = await rows(sql`
    SELECT id, status, title, description, price, condition FROM listing_drafts
    WHERE id IN (${sql.join(clean.map((id) => sql`${id}`), sql`, `)})`);
  const byId = new Map(found.map((r) => [String(r.id), r]));
  for (const id of clean) {
    const d = byId.get(id);
    if (!d) { out.skipped.push({ id, reason: "not found" }); continue; }
    if (!["review", "ready", "sent_back"].includes(String(d.status))) {
      out.skipped.push({ id, reason: `status is ${d.status}` });
      continue;
    }
    const gaps = approvalGaps(d);
    if (gaps.length) { out.skipped.push({ id, reason: `missing ${gaps.join(", ")}` }); continue; }
    const done = await rows(sql`
      UPDATE listing_drafts SET status = 'approved', approved_at = now(), approved_by = ${who}, updated_at = now()
      WHERE id = ${id} AND status = ${String(d.status)} RETURNING id`);
    if (done.length) out.approved.push(id);
    else out.skipped.push({ id, reason: "changed while approving" });
  }
  return out;
}

export async function unapproveDraft(id: string): Promise<{ ok: boolean; error?: string }> {
  const done = await rows(sql`
    UPDATE listing_drafts SET status = 'review', approved_at = NULL, approved_by = NULL, updated_at = now()
    WHERE id = ${id} AND status = 'approved' RETURNING id`);
  return done.length ? { ok: true } : { ok: false, error: "Only an approved (not yet published) draft can be unapproved" };
}

/** Send back with a note — the note becomes the writer's corrections on
 *  the next "Write". */
export async function sendBackDraft(id: string, note: string | null): Promise<{ ok: boolean; error?: string }> {
  const text = (note ?? "").trim().slice(0, 2000) || null;
  const done = await rows(sql`
    UPDATE listing_drafts SET status = 'sent_back', review_note = ${text}, approved_at = NULL, approved_by = NULL,
           updated_at = now()
    WHERE id = ${id} AND status IN ('review', 'approved', 'ready') RETURNING id`);
  return done.length ? { ok: true } : { ok: false, error: "This draft can't be sent back right now" };
}
