// Lots (LIST-LOT): drafts Todd sent to Claude together with "combine lots"
// on can be merged by Claude into one lot draft, and any draft can get a
// cover collage made from chosen photos.
//
// Combining: the first draft becomes the lot. Every part's photos move onto
// it (rows re-pointed, nothing re-uploaded) in the order cover → each part's
// front then its own back/insides, item by item, up to eBay's 24. A cover is built from the fronts. The
// other drafts are set aside as "discarded" with combinedInto (their registry
// items archived, like any discard), and the lot keeps one bin (the first
// draft's — Todd: "pick one, doesn't matter which"). ai_meta.lot records the
// parts so Todd sees it's a lot, and so "Split lot" can put everything back.

import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { putObject, publicUrl, r2Config } from "@/lib/storage/r2";
import { renderCover, COVER_MAX_TILES, COVER_SIZE, type CoverOptions } from "./cover";
import { FIT_MAX_PIECES } from "./photo-fit-plan";
import { clearFitTiles, fitLotPhotos } from "./photo-fit";
import { ROTATABLE } from "./photos";
import { CLAUDE_STATUS } from "./claude";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTOS = 24;
const PARK_FROM = 1001; // photos that don't fit the lot wait on a set-aside part from here

export type LotPart = {
  draftId: string;
  title: string | null;
  bin: string | null;
  /** Every photo the part had, with where it was, so a split restores it. */
  photos: Array<{ id: string; position: number }>;
  /** A lot-pool candidate (an item that was listed on its own): no draft;
   *  its photos are copies of its eBay photos on the lot draft. */
  candidate?: { registryItemId: string; memberId: string };
  /** A pooled piece Claude pulled out of the lot pool into a batch lot;
   *  a split puts it back in the pool (same lot, bin LOTPOOL). */
  fromPool?: { memberId: string; groupId: string | null };
  /** Added later to an open lot (lib/listings/open-lots.ts); a split sends
   *  it back to Ready like any combined piece. */
  addedOpen?: boolean;
};
export type LotMeta = {
  parts: LotPart[];
  coverPhotoId: string | null;
  combinedAt: string;
  combinedBy: string;
  reason: string | null;
  /** Built from a lot-pool group (lib/listings/pool.ts): splitting puts the
   *  pieces back in the pool rather than back to Ready. */
  poolGroupId?: string;
  poolMemberIds?: string[];
  /** Pieces added while the lot was held open ("Keep lot open"). */
  additions?: Array<{ at: string; by: string; pieces: string[]; reason: string | null }>;
};

type P = { id: string; draftId: string; position: number; role: string | null };

/** Pure: the part's front — its "front" photo, else its cover, else its first
 *  photo that isn't a back / inside / detail, else its first photo. */
export function frontOf(photos: P[]): P | null {
  const sorted = [...photos].sort((a, b) => a.position - b.position);
  return (
    sorted.find((p) => p.role === "front") ??
    sorted.find((p) => p.role === "cover") ??
    sorted.find((p) => !["back", "inside", "detail"].includes(p.role ?? "")) ??
    sorted[0] ??
    null
  );
}

/** Pure: lot photo order (without the cover), item by item — each part's
 *  front, then that part's back/inside/details — so buyers can tell which
 *  back goes with which front. When there isn't room for everything, every
 *  part's front is kept first, then the other photos part by part; whatever
 *  doesn't fit in `room` is parked. */
export function lotOrder(parts: P[][], room: number): { keep: P[]; park: P[] } {
  const byPart = parts.map((ps) => {
    const sorted = [...ps].sort((a, b) => a.position - b.position);
    const front = frontOf(sorted);
    return front ? [front, ...sorted.filter((p) => p.id !== front.id)] : sorted;
  });
  // Which photos make the cut (same priority as before: fronts first).
  const priority = [...byPart.map((ps) => ps[0]).filter((p): p is P => !!p), ...byPart.flatMap((ps) => ps.slice(1))];
  const kept = new Set(priority.slice(0, Math.max(0, room)).map((p) => p.id));
  const all = byPart.flat();
  return { keep: all.filter((p) => kept.has(p.id)), park: priority.filter((p) => !kept.has(p.id)) };
}

/** Move photos to their places without tripping the (draft, position)
 *  unique index: first everything to unique negative spots, then home. */
export async function placePhotos(moves: Array<{ id: string; draftId: string; position: number }>): Promise<void> {
  for (const [i, m] of moves.entries()) {
    await db.execute(sql`UPDATE draft_photos SET position = ${-100000 - i} WHERE id = ${m.id}::uuid`);
  }
  for (const m of moves) {
    await db.execute(sql`UPDATE draft_photos SET draft_id = ${m.draftId}::uuid, position = ${m.position} WHERE id = ${m.id}::uuid`);
  }
}

export async function uploadCover(
  draftId: string,
  urls: string[],
  opts: CoverOptions & { side?: number } = {}
): Promise<{ key: string; url: string; bytes: number }> {
  const cfg = r2Config();
  if (!cfg) throw new Error("Photo storage (R2) is not configured");
  const jpg = await renderCover(urls, opts.side ?? COVER_SIZE, opts);
  const key = `drafts/${draftId}/cover/${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.jpg`;
  await putObject(cfg, key, jpg, "image/jpeg");
  return { key, url: publicUrl(cfg, key), bytes: jpg.length };
}

export async function insertCoverRow(draftId: string, cover: { key: string; url: string; bytes: number }, position: number): Promise<string> {
  const [r] = await rows(sql`
    INSERT INTO draft_photos (draft_id, position, role, storage_key, url, original_name, bytes, content_type, uploaded_at)
    VALUES (${draftId}::uuid, ${position}, 'cover', ${cover.key}, ${cover.url}, '00-cover.jpg', ${cover.bytes}, 'image/jpeg', now())
    RETURNING id`);
  return String(r.id);
}

export async function loadPhotos(draftIds: string[]): Promise<P[]> {
  const list = await rows(sql`
    SELECT id, draft_id, position, role FROM draft_photos
    WHERE draft_id IN (${sql.join(draftIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND uploaded_at IS NOT NULL
    ORDER BY position`);
  return list.map((p) => ({ id: String(p.id), draftId: String(p.draft_id), position: Number(p.position), role: p.role == null ? null : String(p.role) }));
}

// ─── combine (Claude, through the connector) ─────────────────────────────────

export async function combineLot(
  ids: string[],
  who: string,
  reason?: string | null,
  poolMemberIds: string[] = []
): Promise<{ lotDraftId: string; parts: number; photos: number; parked: number; bin: string | null; note: string }> {
  const queuedIds = Array.from(new Set(ids.filter((id) => UUID.test(id))));
  if (!queuedIds.length) throw new Error("Give at least one draft id from listing_queue (the lot is built on it).");
  // Pooled pieces from the lot pool can join a lot formed in this batch.
  const poolIds = Array.from(new Set(poolMemberIds.filter((id) => UUID.test(id))));
  const pool = poolIds.length
    ? await rows(sql`
        SELECT p.id, p.draft_id, p.group_id FROM lot_pool p JOIN listing_drafts d ON d.id = p.draft_id
        WHERE p.id IN (${sql.join(poolIds.map((id) => sql`${id}::uuid`), sql`, `)})
          AND p.status = 'waiting' AND p.kind = 'pooled' AND d.status = 'pooled'`)
    : [];
  if (pool.length !== poolIds.length)
    throw new Error("Some of those lot pool pieces aren't waiting in the pool as pooled drafts (still-listed candidates can only be listed from the Lot pool page).");
  const poolByDraft = new Map(pool.map((p) => [String(p.draft_id), p]));
  const clean = [...queuedIds, ...pool.map((p) => String(p.draft_id)).filter((id) => !queuedIds.includes(id))];
  if (clean.length < 2) throw new Error("A lot needs at least two pieces.");
  if (clean.length > FIT_MAX_PIECES) throw new Error(`A lot can have at most ${FIT_MAX_PIECES} pieces.`);
  const found = await rows(sql`
    SELECT id, status, title, title_hint, bin_sku, registry_item_id, ai_meta FROM listing_drafts
    WHERE id IN (${sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `)})`);
  if (found.length !== clean.length) throw new Error("One of those ids isn't a draft.");
  const byId = new Map(found.map((d) => [String(d.id), d]));
  const drafts = clean.map((id) => byId.get(id)!);
  const meta = (d: Row) => (d.ai_meta ?? {}) as Record<string, unknown>;
  for (const d of drafts.filter((x) => !poolByDraft.has(String(x.id)))) {
    if (String(d.status) !== CLAUDE_STATUS) throw new Error(`Draft ${d.id} isn't waiting for Claude, so it can't go in a lot.`);
    if (meta(d).claudeLots !== true)
      throw new Error(
        `Todd didn't turn on "combine lots" for draft ${d.id}. If Todd has said in this chat to combine these, call listing_allow_lots with their ids first; otherwise write it on its own.`
      );
    if (meta(d).lot) throw new Error(`Draft ${d.id} is already a lot.`);
  }
  const batch = new Set(drafts.filter((x) => !poolByDraft.has(String(x.id))).map((d) => String(meta(d).claudeBatch ?? "")));
  if (batch.size !== 1 || batch.has("")) throw new Error("Only drafts Todd sent together (the same batch) can be combined.");

  const lot = drafts[0];
  const lotId = String(lot.id);
  const photos = await loadPhotos(clean);
  const perPart = clean.map((id) => photos.filter((p) => p.draftId === id));
  if (perPart.some((ps) => !ps.length)) throw new Error("Every draft in a lot needs at least one uploaded photo.");

  // Everything comes onto the lot; fitLotPhotos (below) then lays it into
  // eBay's 24, merging scans only when there are more than fit.
  const { keep, park } = lotOrder(perPart, Number.MAX_SAFE_INTEGER);
  const fronts = perPart.map(frontOf).filter((p): p is P => !!p);
  const urls = await rows(sql`
    SELECT id, url FROM draft_photos WHERE id IN (${sql.join(fronts.map((f) => sql`${f.id}::uuid`), sql`, `)})`);
  const urlOf = new Map(urls.map((u) => [String(u.id), String(u.url)]));
  const cover = await uploadCover(lotId, fronts.map((f) => urlOf.get(f.id)!).filter(Boolean));

  const parkOn = clean[1];
  await placePhotos([
    ...keep.map((p, i) => ({ id: p.id, draftId: lotId, position: i + 2 })),
    ...park.map((p, i) => ({ id: p.id, draftId: parkOn, position: PARK_FROM + i })),
  ]);
  const coverId = await insertCoverRow(lotId, cover, 1);

  const lotMeta: LotMeta = {
    parts: drafts.map((d, i) => ({
      draftId: String(d.id),
      title: (d.title as string | null) ?? (d.title_hint as string | null) ?? null,
      bin: (d.bin_sku as string | null) ?? null,
      photos: perPart[i].map((p) => ({ id: p.id, position: p.position })),
      ...(poolByDraft.has(String(d.id))
        ? { fromPool: { memberId: String(poolByDraft.get(String(d.id))!.id), groupId: (poolByDraft.get(String(d.id))!.group_id as string | null) ?? null } }
        : {}),
    })),
    coverPhotoId: coverId,
    combinedAt: new Date().toISOString(),
    combinedBy: who,
    reason: (reason ?? "").trim().slice(0, 600) || null,
    ...(pool.length ? { poolMemberIds: pool.map((p) => String(p.id)) } : {}),
  };
  const hint = `Lot of ${drafts.length}: ${lotMeta.parts.map((p) => p.title ?? "item").join(" + ")}`.slice(0, 300);
  await db.execute(sql`
    UPDATE listing_drafts SET title_hint = ${hint}, quantity = 1,
      ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('lot', ${JSON.stringify(lotMeta)}::jsonb),
      updated_at = now()
    WHERE id = ${lotId}::uuid`);
  for (const d of drafts.slice(1)) {
    await db.execute(sql`
      UPDATE listing_drafts SET status = 'discarded', review_note = ${`combined into a lot (${lotId})`},
        ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('combinedInto', ${lotId}::text),
        updated_at = now()
      WHERE id = ${String(d.id)}::uuid`);
    if (d.registry_item_id) {
      await db.execute(sql`UPDATE registry_items SET status = 'archived', updated_at = now() WHERE id = ${String(d.registry_item_id)} AND status = 'draft'`);
    }
  }
  if (pool.length) {
    await db.execute(sql`UPDATE lot_pool SET status = 'in_lot', updated_at = now()
      WHERE id IN (${sql.join(pool.map((p) => sql`${String(p.id)}::uuid`), sql`, `)})`);
    // A pool lot whose every piece went into this lot is done.
    const groups = Array.from(new Set(pool.map((p) => p.group_id).filter(Boolean).map(String)));
    for (const g of groups) {
      await db.execute(sql`
        UPDATE lot_groups SET status = 'listed', lot_draft_id = ${lotId}::uuid, updated_at = now()
        WHERE id = ${g}::uuid AND status = 'forming'
          AND NOT EXISTS (SELECT 1 FROM lot_pool x WHERE x.group_id = ${g}::uuid AND x.status = 'waiting')`);
    }
  }
  const fit = await fitLotPhotos(lotId).catch((err) => {
    console.warn(`[lots] ${lotId}: fitting photos failed:`, err);
    return null;
  });
  return {
    lotDraftId: lotId,
    parts: drafts.length,
    photos: fit?.listed ?? keep.length + 1,
    parked: park.length,
    bin: (lot.bin_sku as string | null) ?? null,
    note:
      `Combined into draft ${lotId} (it stays in your queue). Photo 1 is a cover made from each piece's front` +
      (fit?.text ? `, numbered 1–${drafts.length}; the ${fit.scans} scans didn't fit eBay's 24 one per photo, so some share a merged photo (${fit.text})` : "") +
      `. ` +
      (fit?.dropped?.length ? `Pieces #${fit.dropped.join(", #")} are only on the cover (no room in the 24 photos). ` : "") +
      `Now call listing_get_draft with ${lotId} and write ONE listing for the whole lot with listing_save.`,
  };
}

// ─── split (Todd, from the draft page) ───────────────────────────────────────

export async function splitLot(lotId: string): Promise<{ restored: number }> {
  if (!UUID.test(lotId)) throw new Error("Bad id");
  const [d] = await rows(sql`SELECT id, status, ai_meta FROM listing_drafts WHERE id = ${lotId}::uuid`);
  if (!d) throw new Error("No such draft");
  const lot = ((d.ai_meta ?? {}) as Record<string, unknown>).lot as LotMeta | undefined;
  if (!lot?.parts?.length) throw new Error("This draft isn't a lot.");
  if (!["ready", "review", "sent_back", CLAUDE_STATUS, "lot_open"].includes(String(d.status)))
    throw new Error(`A lot can only be split before it's approved (this one is "${String(d.status).replace("_", " ")}").`);

  if (lot.coverPhotoId) await db.execute(sql`DELETE FROM draft_photos WHERE id = ${lot.coverPhotoId}::uuid AND draft_id = ${lotId}::uuid`);
  await clearFitTiles(lotId); // FIA's merged photos (photo-fit.ts)
  await db.execute(sql`UPDATE listing_drafts SET ai_meta = ai_meta - 'photoFit' WHERE id = ${lotId}::uuid`);
  if (lot.poolGroupId) return splitPoolLot(lotId, lot);
  // Photos Todd added to the lot afterwards (e.g. his own cover) stay on it,
  // after the first part's own photos.
  const known = new Set(lot.parts.flatMap((p) => p.photos.map((x) => x.id)));
  const extra = (await loadPhotos([lotId])).filter((p) => !known.has(p.id));
  const maxOwn = Math.max(0, ...lot.parts[0].photos.map((x) => x.position));
  await placePhotos([
    ...lot.parts.flatMap((p) => p.photos.map((x) => ({ id: x.id, draftId: p.draftId, position: x.position }))),
    ...extra.map((p, i) => ({ id: p.id, draftId: lotId, position: maxOwn + 1 + i })),
  ]);

  for (const p of lot.parts.slice(1)) {
    const [r] = await rows(sql`
      UPDATE listing_drafts SET status = ${p.fromPool ? "pooled" : "ready"}, review_note = NULL, ai_meta = COALESCE(ai_meta, '{}'::jsonb) - 'combinedInto', updated_at = now()
      WHERE id = ${p.draftId}::uuid AND status = 'discarded' RETURNING registry_item_id`);
    if (p.fromPool) {
      // Back in the lot pool, in the same forming lot.
      await db.execute(sql`UPDATE lot_pool SET status = 'waiting', group_id = ${p.fromPool.groupId}::uuid, updated_at = now() WHERE id = ${p.fromPool.memberId}::uuid`);
      if (p.fromPool.groupId) await db.execute(sql`UPDATE lot_groups SET status = 'forming', lot_draft_id = NULL, updated_at = now() WHERE id = ${p.fromPool.groupId}::uuid AND status = 'listed'`);
    }
    if (r?.registry_item_id) {
      await db.execute(sql`UPDATE registry_items SET status = 'draft', updated_at = now() WHERE id = ${String(r.registry_item_id)} AND status = 'archived'`);
    }
  }
  // The lot's text described the whole lot, so the first part starts over.
  await db.execute(sql`
    UPDATE listing_drafts SET status = 'ready', title = NULL, description = NULL, price = NULL, item_specifics = NULL,
      written_by = NULL, title_hint = ${lot.parts[0].title}, review_note = NULL,
      ai_meta = (COALESCE(ai_meta, '{}'::jsonb) - 'lot') - 'lotOpen', updated_at = now()
    WHERE id = ${lotId}::uuid`);
  return { restored: lot.parts.length };
}

/** A lot made from the lot pool goes back into the pool: pooled pieces get
 *  their photos back and wait again (bin LOTPOOL), candidates wait again
 *  (still delisted), and the lot is forming again. A lot that was made only
 *  of candidates had a new draft, which is set aside. */
async function splitPoolLot(lotId: string, lot: LotMeta): Promise<{ restored: number }> {
  // Pieces added while the lot was open weren't from the pool: back to Ready.
  const added = lot.parts.filter((p) => p.draftId && p.addedOpen && p.draftId !== lotId);
  if (added.length) {
    await placePhotos(added.flatMap((p) => p.photos.map((x) => ({ id: x.id, draftId: p.draftId, position: x.position }))));
    for (const p of added) {
      const [r] = await rows(sql`
        UPDATE listing_drafts SET status = 'ready', review_note = NULL, ai_meta = COALESCE(ai_meta, '{}'::jsonb) - 'combinedInto', updated_at = now()
        WHERE id = ${p.draftId}::uuid AND status = 'discarded' RETURNING registry_item_id`);
      if (r?.registry_item_id) {
        await db.execute(sql`UPDATE registry_items SET status = 'draft', updated_at = now() WHERE id = ${String(r.registry_item_id)} AND status = 'archived'`);
      }
    }
  }
  const pooled = lot.parts.filter((p) => p.draftId && !p.addedOpen);
  const candPhotos = lot.parts.filter((p) => p.candidate).flatMap((p) => p.photos.map((x) => x.id));
  if (candPhotos.length) {
    await db.execute(sql`DELETE FROM draft_photos WHERE id IN (${sql.join(candPhotos.map((id) => sql`${id}::uuid`), sql`, `)}) AND storage_key LIKE 'external:%'`);
  }
  const known = new Set(pooled.flatMap((p) => p.photos.map((x) => x.id)));
  const extra = pooled.length && pooled[0].draftId === lotId ? (await loadPhotos([lotId])).filter((p) => !known.has(p.id)) : [];
  const maxOwn = Math.max(0, ...(pooled[0]?.photos ?? []).map((x) => x.position));
  await placePhotos([
    ...pooled.flatMap((p) => p.photos.map((x) => ({ id: x.id, draftId: p.draftId, position: x.position }))),
    ...extra.map((p, i) => ({ id: p.id, draftId: lotId, position: maxOwn + 1 + i })),
  ]);
  for (const p of pooled) {
    const [r] = await rows(sql`
      UPDATE listing_drafts SET status = 'pooled', bin_sku = 'LOTPOOL', review_note = NULL, title = NULL, description = NULL,
        price = NULL, item_specifics = NULL, written_by = NULL, title_hint = COALESCE(${p.title}, title_hint),
        ai_meta = ((COALESCE(ai_meta, '{}'::jsonb) - 'combinedInto') - 'lot') - 'lotOpen', updated_at = now()
      WHERE id = ${p.draftId}::uuid RETURNING registry_item_id`);
    if (r?.registry_item_id) {
      await db.execute(sql`UPDATE registry_items SET status = 'draft', bin_sku = 'LOTPOOL', updated_at = now() WHERE id = ${String(r.registry_item_id)} AND status IN ('archived', 'draft')`);
    }
  }
  if (!pooled.some((p) => p.draftId === lotId)) {
    await db.execute(sql`UPDATE listing_drafts SET status = 'discarded', review_note = 'lot split back into the lot pool', updated_at = now() WHERE id = ${lotId}::uuid`);
  }
  if (lot.poolMemberIds?.length) {
    await db.execute(sql`UPDATE lot_pool SET status = 'waiting', group_id = ${lot.poolGroupId}::uuid, updated_at = now()
      WHERE id IN (${sql.join(lot.poolMemberIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  }
  await db.execute(sql`UPDATE lot_groups SET status = 'forming', lot_draft_id = NULL, updated_at = now() WHERE id = ${lot.poolGroupId}::uuid`);
  return { restored: lot.parts.length };
}

// ─── a cover for any draft (Todd, from the draft page) ──────────────────────

/** Build a cover from the photos at `positions` (in that order) and make it
 *  photo 1. A cover FIA made earlier at photo 1 is replaced, not stacked. */
export async function makeDraftCover(draftId: string, positions: number[]): Promise<{ url: string; tiles: number }> {
  if (!UUID.test(draftId)) throw new Error("Bad id");
  const [d] = await rows(sql`SELECT status, ai_meta FROM listing_drafts WHERE id = ${draftId}::uuid`);
  if (!d) throw new Error("No such draft");
  if (!ROTATABLE.includes(String(d.status))) throw new Error(`Photos can't change once a draft is "${String(d.status).replace("_", " ")}".`);
  const pos = Array.from(new Set(positions.map(Number).filter(Number.isInteger)));
  if (!pos.length) throw new Error("Tick the photos to put on the cover.");
  const list = await rows(sql`
    SELECT id, position, url, role, storage_key FROM draft_photos WHERE draft_id = ${draftId}::uuid AND uploaded_at IS NOT NULL ORDER BY position`);
  const at = new Map(list.map((p) => [Number(p.position), p]));
  const chosen = pos.map((p) => at.get(p)).filter((p): p is Row => !!p);
  if (!chosen.length) throw new Error("Those photos weren't found.");
  const cover = await uploadCover(draftId, chosen.map((p) => String(p.url)).slice(0, COVER_MAX_TILES));

  const first = list[0];
  const ourCover = first && String(first.role) === "cover" && /\/cover\//.test(String(first.storage_key));
  const lot = ((d.ai_meta ?? {}) as Record<string, unknown>).lot as LotMeta | undefined;
  if (ourCover) {
    await db.execute(sql`
      UPDATE draft_photos SET storage_key = ${cover.key}, url = ${cover.url}, bytes = ${cover.bytes}, rotation = 0, original_url = NULL
      WHERE id = ${String(first.id)}::uuid`);
  } else {
    if (list.length >= MAX_PHOTOS) throw new Error("This draft already has 24 photos (eBay's limit); a cover would be the 25th.");
    await placePhotos(list.map((p) => ({ id: String(p.id), draftId, position: Number(p.position) + 1 })));
    // Everything moved up one, so the old first slot is free for the cover.
    const minPos = list.length ? Math.min(...list.map((p) => Number(p.position))) : 1;
    const id = await insertCoverRow(draftId, cover, minPos);
    // A lot's cover is set aside by "Split lot"; a new one replaces it there.
    if (lot && !lot.coverPhotoId) {
      await db.execute(sql`UPDATE listing_drafts SET ai_meta = jsonb_set(ai_meta, '{lot,coverPhotoId}', to_jsonb(${id}::text)) WHERE id = ${draftId}::uuid`);
    }
  }
  await db.execute(sql`UPDATE listing_drafts SET updated_at = now() WHERE id = ${draftId}::uuid`);
  return { url: cover.url, tiles: chosen.length };
}
