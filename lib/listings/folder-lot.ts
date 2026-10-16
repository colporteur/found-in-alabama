// Whole-folder lots: the Scans page sends a folder of loose photos as ONE
// lot draft, one photo per piece, more pieces than eBay's 24 photos allow.
//
// Every original stays on the draft. The photos that are listed are laid
// out so every piece shows at least twice:
//   photo 1      a numbered overview of every piece (the cover)
//   23 or fewer pieces: each piece's own photo after it
//   more than 23: 22 pieces get their own photo, then one "Also included"
//                 grid (photo 24) of the rest, numbered the same way; the
//                 originals of those wait at position 1001+ (never listed —
//                 Nifty and eBay take the first 24 by position).
// Claude (listing_lot_photos) or Todd (the draft page) picks which pieces
// get their own photo; the overview and grid are rebuilt each time.
// ai_meta.folderLot records the pieces (in the order sent) so the numbers
// never change.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { insertCoverRow, placePhotos, uploadCover } from "./lots";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FOLDER_LOT_MAX = 60; // pieces (photos) one folder lot can hold
export const LISTED_PHOTOS = 24; // eBay's and Nifty's limit
export const SOLO_SLOTS = LISTED_PHOTOS - 2; // overview + solos + the grid
const PARK_FROM = 1001;

export type FolderLotMeta = {
  /** Every piece in the order sent; piece n is pieces[n - 1]. */
  pieces: Array<{ photoId: string; name: string | null }>;
  /** Piece numbers with their own listed photo, in listed order. */
  solo: number[];
  coverPhotoId: string | null;
  gridPhotoId: string | null;
  arrangedAt: string;
  arrangedBy: string;
};

/** Pure: which pieces get their own photo and which go in the grid.
 *  `wanted` (piece numbers, best first) is checked, deduplicated and
 *  topped up in order so no listed slot is wasted. */
export function planFolderLot(n: number, wanted?: number[] | null): { solo: number[]; grid: number[] } {
  const all = Array.from({ length: n }, (_, i) => i + 1);
  if (n <= LISTED_PHOTOS - 1) {
    // Everything fits: Claude's order if given, the rest after it.
    const first = Array.from(new Set((wanted ?? []).filter((x) => Number.isInteger(x) && x >= 1 && x <= n)));
    return { solo: [...first, ...all.filter((x) => !first.includes(x))], grid: [] };
  }
  const picked = Array.from(new Set((wanted ?? []).filter((x) => Number.isInteger(x) && x >= 1 && x <= n))).slice(0, SOLO_SLOTS);
  for (const x of all) {
    if (picked.length >= SOLO_SLOTS) break;
    if (!picked.includes(x)) picked.push(x);
  }
  return { solo: picked, grid: all.filter((x) => !picked.includes(x)) };
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
): Promise<{ pieces: number; solo: number[]; grid: number[]; listed: number }> {
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
  const { solo, grid } = planFolderLot(n, wanted ?? prev?.solo ?? null);
  const urlOf = (k: number) => String(byId.get(pieces[k - 1].photoId)!.url);
  const labels = (list: number[]) => list.map(String);

  // Overview of every piece, numbered; bigger than a normal cover when crowded.
  // It only changes when the pieces do (a turned photo → "rebuild").
  const keepCover = !opts.rebuildCover && prev?.coverPhotoId && byId.has(prev.coverPhotoId) ? prev.coverPhotoId : null;
  const cover = keepCover
    ? null
    : await uploadCover(draftId, pieces.map((_, i) => urlOf(i + 1)), {
        labels: labels(pieces.map((_, i) => i + 1)),
        maxTiles: FOLDER_LOT_MAX,
        side: n > 16 ? 2000 : 1600,
      });
  const gridImg = grid.length
    ? await uploadCover(draftId, grid.map(urlOf), { labels: labels(grid), maxTiles: FOLDER_LOT_MAX, side: grid.length > 9 ? 2000 : 1600 })
    : null;

  // Out with the old overview and grid (only rows FIA made).
  const old = [keepCover ? null : prev?.coverPhotoId, prev?.gridPhotoId].filter((x): x is string => !!x && byId.has(x));
  if (old.length) {
    await db.execute(sql`DELETE FROM draft_photos WHERE draft_id = ${draftId}::uuid
      AND id IN (${sql.join(old.map((id) => sql`${id}::uuid`), sql`, `)})`);
  }
  // Anything else on the draft (a photo Todd added by hand) waits after the parked originals.
  const known = new Set([...pieces.map((p) => p.photoId), ...old, ...(keepCover ? [keepCover] : [])]);
  const extra = photos.filter((p) => !known.has(String(p.id)));
  const gridPos = grid.length ? solo.length + 2 : null;
  await placePhotos([
    ...(keepCover ? [{ id: keepCover, draftId, position: 1 }] : []),
    ...solo.map((k, i) => ({ id: pieces[k - 1].photoId, draftId, position: i + 2 })),
    ...grid.map((k, i) => ({ id: pieces[k - 1].photoId, draftId, position: PARK_FROM + i })),
    ...extra.map((p, i) => ({ id: String(p.id), draftId, position: PARK_FROM + grid.length + i })),
  ]);
  const coverId = keepCover ?? (await insertCoverRow(draftId, cover!, 1));
  let gridId: string | null = null;
  if (gridImg && gridPos) {
    gridId = await insertCoverRow(draftId, gridImg, gridPos);
    await db.execute(sql`UPDATE draft_photos SET role = 'detail', original_name = 'also-included.jpg' WHERE id = ${gridId}::uuid`);
  }
  await db.execute(sql`UPDATE draft_photos SET role = 'front' WHERE draft_id = ${draftId}::uuid
    AND id IN (${sql.join(pieces.map((p) => sql`${p.photoId}::uuid`), sql`, `)}) AND role IS NULL`);

  const meta: FolderLotMeta = {
    pieces,
    solo,
    coverPhotoId: coverId,
    gridPhotoId: gridId,
    arrangedAt: new Date().toISOString(),
    arrangedBy: who,
  };
  await db.execute(sql`
    UPDATE listing_drafts SET quantity = 1, updated_at = now(),
      ai_meta = (COALESCE(ai_meta, '{}'::jsonb) - 'folderLotError') || jsonb_build_object('folderLot', ${JSON.stringify(meta)}::jsonb)
    WHERE id = ${draftId}::uuid`);
  return { pieces: n, solo, grid, listed: 1 + solo.length + (gridId ? 1 : 0) };
}

/** What Claude is told about a folder lot (listing_get_draft). */
export function folderLotText(f: FolderLotMeta): string {
  const n = f.pieces.length;
  const { grid } = planFolderLot(n, f.solo);
  const solo = f.solo;
  return (
    `THIS IS A LOT of ${n} pieces Todd sent as one folder (one photo per piece, numbered 1–${n} in the order scanned). ` +
    `Photo 1 is a numbered overview of all ${n}. Photos 2–${solo.length + 1} are pieces #${solo.join(", #")}, each on its own` +
    (grid.length
      ? `; photo ${solo.length + 2} is the "Also included" grid of pieces #${grid.join(", #")} (eBay allows 24 photos, so those ${grid.length} share one). ` +
        `Their full-size photos are after that (listing_get_photos from=${solo.length + 3}) — look at them before writing. ` +
        `Before you write, pick which ${solo.length} pieces deserve their own photo — the strongest, most searchable, best condition — with listing_lot_photos (it rebuilds the grid from the rest); the defaults are just the first ${solo.length} scanned. `
      : ". ") +
    `Write ONE listing for the whole lot: the title starts "Lot of ${n}" (or names the set), the description covers the pieces in turn (by number is fine — buyers see the numbers on the photos) with condition, item specifics fit the lot as a whole, and the price is for the lot. Quantity stays 1. Never mention bins.`
  );
}
