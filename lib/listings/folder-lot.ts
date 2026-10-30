// Whole-folder lots: the Scans page sends a folder of loose photos as ONE
// lot draft, one photo per piece, more pieces than eBay's 24 photos allow.
//
// Every original stays on the draft. The listed photos:
//   photo 1      a numbered overview of every piece (the cover)
//   23 or fewer pieces: each piece's own photo after it
//   more than 23: "fit to 24" (photo-fit-plan.ts) — neighbouring pieces
//                 share merged 2–4-up photos, numbered like the overview,
//                 only as many as needed; the originals of merged pieces
//                 wait at position 1001+ (never listed — Nifty and eBay
//                 take the first 24 by position).
// Claude (listing_lot_photos) or Todd (the draft page) can pick pieces that
// keep their own photo; Todd can switch merging off (photoFit.soloOnly).
// ai_meta.folderLot records the pieces (in the order sent) so the numbers
// never change.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { insertCoverRow, placePhotos, uploadCover } from "./lots";
import { FIT_MAX_PER_TILE, FIT_SLOTS, fitText, planFit, type FitPlan } from "./photo-fit-plan";
import { FIT_TILE_PREFIX, photoFitOf } from "./photo-fit";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FOLDER_LOT_MAX = 60; // pieces (photos) one folder lot can hold
export const LISTED_PHOTOS = 24; // eBay's and Nifty's limit
const PARK_FROM = 1001;

export type FolderLotMeta = {
  /** Every piece in the order sent; piece n is pieces[n - 1]. */
  pieces: Array<{ photoId: string; name: string | null }>;
  /** Piece numbers with a listed photo of their own, in listed order. */
  solo: number[];
  /** Pieces Claude or Todd chose to keep on their own photo, best first. */
  picked?: number[];
  coverPhotoId: string | null;
  /** Before Oct 30, 2026: one "Also included" grid. */
  gridPhotoId?: string | null;
  /** FIA's merged photos (rows), in listed order. */
  tileIds?: string[];
  /** Where each piece is: "photo 2: #1; photo 3: #2 + #3 (merged, 2 scans)…" */
  text?: string;
  /** Pieces only on the overview (no room in the 24). */
  dropped?: number[];
  arrangedAt: string;
  arrangedBy: string;
};

/** Pure: most pieces that can keep their own photo while every other piece
 *  still fits (n pieces, one scan each). */
export function maxPicks(n: number): number {
  if (n <= FIT_SLOTS) return n;
  return Math.max(0, Math.min(FIT_SLOTS - 1, Math.floor((FIT_SLOTS * FIT_MAX_PER_TILE - n) / (FIT_MAX_PER_TILE - 1))));
}

/** Pure: photos 2–24 for n one-scan pieces (scan id = piece number). */
export function planFolderLot(n: number, picked?: number[] | null, soloOnly = false): FitPlan {
  const pieces = Array.from({ length: n }, (_, i) => ({ n: i + 1, scans: [String(i + 1)] }));
  const prefer = Array.from(new Set((picked ?? []).filter((x) => Number.isInteger(x) && x >= 1 && x <= n)));
  return planFit(pieces, { prefer, soloOnly });
}

export function folderLotOf(aiMeta: unknown): FolderLotMeta | null {
  const m = (aiMeta ?? {}) as Record<string, unknown>;
  const f = m.folderLot as FolderLotMeta | undefined;
  return f && Array.isArray(f.pieces) && f.pieces.length ? f : null;
}

/** Lay out a folder lot's photos (first time, or again with new solo picks).
 *  The first time, the pieces are the draft's photos in the order sent. */
export async function arrangeFolderLot(
  draftId: string,
  wanted: number[] | null,
  who: string,
  opts: { rebuildCover?: boolean } = {}
): Promise<{ pieces: number; solo: number[]; merged: number; dropped: number[]; listed: number; text: string }> {
  if (!UUID.test(draftId)) throw new Error("Bad id");
  const [d] = await rows(sql`SELECT id, status, ai_meta FROM listing_drafts WHERE id = ${draftId}::uuid`);
  if (!d) throw new Error("No such draft");
  const prev = folderLotOf(d.ai_meta);
  const photos = await rows(sql`
    SELECT id, position, url, original_name, role FROM draft_photos
    WHERE draft_id = ${draftId}::uuid AND uploaded_at IS NOT NULL ORDER BY position`);
  const byId = new Map(photos.map((p) => [String(p.id), p]));

  let pieces: FolderLotMeta["pieces"];
  if (prev) {
    pieces = prev.pieces.filter((p) => byId.has(p.photoId));
    if (pieces.length !== prev.pieces.length) throw new Error("Some of this lot's photos are missing; it can't be rearranged.");
  } else {
    pieces = photos
      .filter((p) => !(String(p.role) === "cover" && /\/cover\//.test(String(p.url))))
      .map((p) => ({ photoId: String(p.id), name: (p.original_name as string | null) ?? null }));
  }
  if (pieces.length < 2) throw new Error("A lot needs at least two pieces.");
  if (pieces.length > FOLDER_LOT_MAX) throw new Error(`A folder lot can have at most ${FOLDER_LOT_MAX} pieces.`);

  const n = pieces.length;
  const picked = wanted ?? prev?.picked ?? [];
  const soloOnly = photoFitOf(d.ai_meta).soloOnly === true;
  const plan = planFolderLot(n, picked, soloOnly);
  const urlOf = (k: number) => String(byId.get(pieces[k - 1].photoId)!.url);

  // Overview of every piece, numbered; bigger than a normal cover when crowded.
  // It only changes when the pieces do (a turned photo → "rebuild").
  const keepCover = !opts.rebuildCover && prev?.coverPhotoId && byId.has(prev.coverPhotoId) ? prev.coverPhotoId : null;
  const cover = keepCover
    ? null
    : await uploadCover(draftId, pieces.map((_, i) => urlOf(i + 1)), {
        labels: pieces.map((_, i) => String(i + 1)),
        maxTiles: FOLDER_LOT_MAX,
        side: n > 16 ? 2000 : 1600,
      });
  // Merged photos of neighbouring pieces, numbered like the overview.
  const made: Array<{ position: number; img: { key: string; url: string; bytes: number } }> = [];
  for (const [i, t] of plan.tiles.entries()) {
    if (t.scans.length < 2) continue;
    const img = await uploadCover(draftId, t.scans.map((s) => urlOf(Number(s))), { labels: t.labels, side: t.scans.length > 2 ? 2000 : 1600 });
    made.push({ position: i + 2, img });
  }

  // Out with FIA's old overview, grid and merged photos.
  const ours = (p: Row) => String(p.original_name ?? "").startsWith(FIT_TILE_PREFIX) && /\/cover\//.test(String(p.url));
  const old = [
    keepCover ? null : prev?.coverPhotoId,
    prev?.gridPhotoId,
    ...(prev?.tileIds ?? []),
    ...photos.filter(ours).map((p) => String(p.id)),
  ].filter((x): x is string => !!x && byId.has(x));
  if (old.length) {
    await db.execute(sql`DELETE FROM draft_photos WHERE draft_id = ${draftId}::uuid
      AND id IN (${sql.join(Array.from(new Set(old)).map((id) => sql`${id}::uuid`), sql`, `)})`);
  }
  // Anything else on the draft (a photo Todd added by hand) waits after the parked originals.
  const known = new Set([...pieces.map((p) => p.photoId), ...old, ...(keepCover ? [keepCover] : [])]);
  const extra = photos.filter((p) => !known.has(String(p.id)));
  const listed = plan.tiles.map((t, i) => ({ t, i })).filter((x) => x.t.scans.length === 1);
  const parked = plan.parked.map(Number);
  await placePhotos([
    ...(keepCover ? [{ id: keepCover, draftId, position: 1 }] : []),
    ...listed.map((x) => ({ id: pieces[Number(x.t.scans[0]) - 1].photoId, draftId, position: x.i + 2 })),
    ...parked.map((k, i) => ({ id: pieces[k - 1].photoId, draftId, position: PARK_FROM + i })),
    ...extra.map((p, i) => ({ id: String(p.id), draftId, position: PARK_FROM + parked.length + i })),
  ]);
  const coverId = keepCover ?? (await insertCoverRow(draftId, cover!, 1));
  const tileIds: string[] = [];
  for (const m of made) {
    const id = await insertCoverRow(draftId, m.img, m.position);
    await db.execute(sql`UPDATE draft_photos SET role = 'detail', original_name = ${`${FIT_TILE_PREFIX}${String(m.position).padStart(2, "0")}.jpg`} WHERE id = ${id}::uuid`);
    tileIds.push(id);
  }
  await db.execute(sql`UPDATE draft_photos SET role = 'front' WHERE draft_id = ${draftId}::uuid
    AND id IN (${sql.join(pieces.map((p) => sql`${p.photoId}::uuid`), sql`, `)}) AND role IS NULL`);

  const solo = listed.map((x) => Number(x.t.scans[0]));
  const meta: FolderLotMeta = {
    pieces,
    solo,
    picked: Array.from(new Set(picked.filter((x) => Number.isInteger(x) && x >= 1 && x <= n))),
    coverPhotoId: coverId,
    gridPhotoId: null,
    tileIds,
    text: n > FIT_SLOTS ? fitText(plan) : "",
    dropped: plan.dropped,
    arrangedAt: new Date().toISOString(),
    arrangedBy: who,
  };
  await db.execute(sql`
    UPDATE listing_drafts SET quantity = 1, updated_at = now(),
      ai_meta = (COALESCE(ai_meta, '{}'::jsonb) - 'folderLotError') || jsonb_build_object('folderLot', ${JSON.stringify(meta)}::jsonb)
    WHERE id = ${draftId}::uuid`);
  return { pieces: n, solo, merged: made.length, dropped: plan.dropped, listed: 1 + plan.tiles.length, text: meta.text ?? "" };
}

/** What Claude is told about a folder lot (listing_get_draft). */
export function folderLotText(f: FolderLotMeta): string {
  const n = f.pieces.length;
  const crowded = n > FIT_SLOTS;
  const listed = crowded ? LISTED_PHOTOS : n + 1;
  return (
    `THIS IS A LOT of ${n} pieces Todd sent as one folder (one photo per piece, numbered 1–${n} in the order scanned). ` +
    `Photo 1 is a numbered overview of all ${n}. ` +
    (crowded
      ? `eBay allows 24 photos, so after the overview some neighbouring pieces share a merged photo, numbered like the overview: ${f.text || "(see the photos)"}. ` +
        (f.dropped?.length ? `Pieces #${f.dropped.join(", #")} are only on the overview. ` : "") +
        `The full-size originals of merged pieces come after photo ${listed} (listing_get_photos from=${listed + 1}) — look at them before writing. ` +
        `If some pieces deserve their own photo (the strongest, most searchable, best condition), name them with listing_lot_photos before writing (best first; up to ${maxPicks(n)}); FIA re-merges the rest. `
      : `Photos 2–${n + 1} are the pieces, each on its own. `) +
    `Write ONE listing for the whole lot: the title starts "Lot of ${n}" (or names the set), the description covers the pieces in turn (by number is fine — buyers see the numbers on the photos) with condition, item specifics fit the lot as a whole, and the price is for the lot. Quantity stays 1. Never mention bins.`
  );
}
