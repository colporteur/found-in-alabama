// "Fit to 24" for lots (plan: photo-fit-plan.ts). After a lot is combined,
// added to, or built from the lot pool, its scans are laid into eBay's 24:
//   photo 1      the cover — every piece's front, numbered when the lot has
//                more scans than fit
//   photos 2–24  single scans, or merged 2–4-up photos FIA makes (numbered
//                like the cover), only as many merges as needed
// Originals that aren't a listed photo of their own wait on the lot draft
// at position 1001+ (never listed: Nifty and eBay take the first 24), so
// Claude can still look at every scan and "Split lot" puts them all back.
// ai_meta.photoFit.soloOnly (Todd's switch on the draft page) turns merging
// off: fronts first, then backs, as many as fit.
// Merged photos are draft_photos rows named "fit-*.jpg" (role detail, under
// the draft's cover/ folder); they're FIA's, so a re-fit or split deletes them.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { frontOf, insertCoverRow, placePhotos, uploadCover, type LotMeta } from "./lots";
import { FIT_MAX_PIECES, FIT_SLOTS, fitText, planFit, type FitPiece, type FitPlan } from "./photo-fit-plan";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const PARK_FROM = 1001;
export const FIT_TILE_PREFIX = "fit-";

export type PhotoFitMeta = {
  soloOnly?: boolean;
  at?: string;
  merged?: boolean;
  /** "photo 2: #1; photo 3: #2 + #3 (merged, 4 scans); …" */
  text?: string;
  /** Listed photos (cover included). */
  listed?: number;
  dropped?: number[];
  error?: string | null;
};

export function photoFitOf(aiMeta: unknown): PhotoFitMeta {
  return (((aiMeta ?? {}) as Record<string, unknown>).photoFit ?? {}) as PhotoFitMeta;
}

/** SQL: a draft_photos row `p` is one of FIA's merged photos. */
export const isFitTileSql = sql`(p.original_name LIKE ${FIT_TILE_PREFIX + "%"} AND p.storage_key LIKE '%/cover/%')`;

/** Delete FIA's merged photos from a draft (before a re-fit, an add or a split). */
export async function clearFitTiles(draftId: string): Promise<void> {
  await db.execute(sql`DELETE FROM draft_photos p WHERE p.draft_id = ${draftId}::uuid AND ${isFitTileSql}`);
}

/** Render one merged photo per multi-scan tile (2 at a time). */
async function renderTiles(draftId: string, plan: FitPlan, urlOf: Map<string, string>) {
  const made = new Map<number, { key: string; url: string; bytes: number }>();
  const todo = plan.tiles.map((t, i) => ({ t, i })).filter((x) => x.t.scans.length > 1);
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const { t, i } = todo[next++];
      made.set(
        i,
        await uploadCover(
          draftId,
          t.scans.map((s) => urlOf.get(s)!),
          { labels: t.labels, side: t.scans.length > 2 ? 2000 : 1600 }
        )
      );
    }
  }
  await Promise.all([worker(), worker()]);
  return made;
}

/** Insert the merged photos at their listed positions, marked as FIA's. */
async function insertTiles(draftId: string, made: Map<number, { key: string; url: string; bytes: number }>) {
  for (const [i, img] of made) {
    const position = i + 2;
    const id = await insertCoverRow(draftId, img, position);
    await db.execute(sql`UPDATE draft_photos SET role = 'detail', original_name = ${`${FIT_TILE_PREFIX}${String(position).padStart(2, "0")}.jpg`} WHERE id = ${id}::uuid`);
  }
}

async function saveFitMeta(draftId: string, fit: PhotoFitMeta) {
  await db.execute(sql`
    UPDATE listing_drafts SET updated_at = now(),
      ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('photoFit', ${JSON.stringify(fit)}::jsonb)
    WHERE id = ${draftId}::uuid`);
}

/** Lay a combined lot's photos into eBay's 24 (see the top of this file).
 *  Safe to run again: it starts from the pieces' own photos each time. If
 *  making the merged photos fails, it falls back to solo photos (fronts
 *  first) so the lot is never left over 24, and records the error. */
export async function fitLotPhotos(lotId: string): Promise<PhotoFitMeta & { pieces: number; scans: number }> {
  const [d] = await rows(sql`SELECT id, ai_meta FROM listing_drafts WHERE id = ${lotId}::uuid`);
  if (!d) throw new Error("No such draft");
  const meta = (d.ai_meta ?? {}) as Record<string, unknown>;
  const lot = meta.lot as LotMeta | undefined;
  if (!lot?.parts?.length) throw new Error("This draft isn't a lot.");
  const prev = photoFitOf(meta);

  const knownIds = lot.parts.flatMap((p) => p.photos.map((x) => x.id));
  const found = knownIds.length
    ? await rows(sql`SELECT id, url, role FROM draft_photos WHERE id IN (${sql.join(knownIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND uploaded_at IS NOT NULL`)
    : [];
  const urlOf = new Map(found.map((r) => [String(r.id), String(r.url)]));
  const roleOf = new Map(found.map((r) => [String(r.id), r.role == null ? null : String(r.role)]));

  // Photos on the lot that belong to no piece and aren't FIA's (Todd's own
  // additions) ride along after piece 1's.
  const onLot = await rows(sql`
    SELECT p.id, p.url, p.role, p.storage_key, p.original_name FROM draft_photos p
    WHERE p.draft_id = ${lotId}::uuid AND p.uploaded_at IS NOT NULL ORDER BY p.position`);
  const known = new Set(knownIds);
  const isOurs = (p: Row) =>
    String(p.id) === lot.coverPhotoId ||
    (String(p.role) === "cover" && /\/cover\//.test(String(p.storage_key))) ||
    (String(p.original_name ?? "").startsWith(FIT_TILE_PREFIX) && /\/cover\//.test(String(p.storage_key)));
  const extras = onLot.filter((p) => !known.has(String(p.id)) && !isOurs(p));
  for (const p of extras) urlOf.set(String(p.id), String(p.url));

  const pieces: FitPiece[] = lot.parts.map((part, i) => {
    // Where each photo was on its own draft, and its role (front / back…).
    const ps = part.photos
      .filter((x) => urlOf.has(x.id))
      .map((x) => ({ id: x.id, draftId: "", position: x.position, role: roleOf.get(x.id) ?? null }));
    const front = frontOf(ps);
    const ordered = front ? [front.id, ...ps.filter((x) => x.id !== front.id).sort((a, b) => a.position - b.position).map((x) => x.id)] : [];
    return { n: i + 1, scans: i === 0 ? [...ordered, ...extras.map((p) => String(p.id))] : ordered };
  });
  const scans = pieces.reduce((a, p) => a + p.scans.length, 0);
  const coverRow = onLot.find((p) => String(p.id) === lot.coverPhotoId) ?? onLot.find((p) => String(p.role) === "cover" && /\/cover\//.test(String(p.storage_key)));

  async function apply(plan: FitPlan, rebuildCover: boolean, made: Map<number, { key: string; url: string; bytes: number }>) {
    // A cover numbered 1–N with every piece's front, when the lot is crowded.
    let coverImg: { key: string; url: string; bytes: number } | null = null;
    if (rebuildCover) {
      const fronts = pieces.filter((p) => p.scans.length).map((p) => ({ n: p.n, url: urlOf.get(p.scans[0])! }));
      coverImg = await uploadCover(lotId, fronts.map((f) => f.url), {
        labels: fronts.map((f) => String(f.n)),
        maxTiles: FIT_MAX_PIECES,
        side: fronts.length > 16 ? 2000 : 1600,
      });
    }
    await clearFitTiles(lotId);
    const listed = plan.tiles.map((t, i) => ({ t, i })).filter((x) => x.t.scans.length === 1);
    const listedIds = new Set(listed.map((x) => x.t.scans[0]));
    const parked = pieces.flatMap((p) => p.scans).filter((s) => !listedIds.has(s));
    await placePhotos([
      ...(coverRow ? [{ id: String(coverRow.id), draftId: lotId, position: 1 }] : []),
      ...listed.map((x) => ({ id: x.t.scans[0], draftId: lotId, position: x.i + 2 })),
      ...parked.map((id, k) => ({ id, draftId: lotId, position: PARK_FROM + k })),
    ]);
    if (coverImg) {
      if (coverRow) {
        await db.execute(sql`
          UPDATE draft_photos SET storage_key = ${coverImg.key}, url = ${coverImg.url}, bytes = ${coverImg.bytes}, rotation = 0, original_url = NULL
          WHERE id = ${String(coverRow.id)}::uuid`);
      } else {
        const id = await insertCoverRow(lotId, coverImg, 1);
        await db.execute(sql`UPDATE listing_drafts SET ai_meta = jsonb_set(ai_meta, '{lot,coverPhotoId}', to_jsonb(${id}::text)) WHERE id = ${lotId}::uuid`);
      }
    }
    await insertTiles(lotId, made);
  }

  const crowded = scans > FIT_SLOTS;
  let plan = planFit(pieces, { soloOnly: prev.soloOnly === true });
  let error: string | null = null;
  try {
    const made = await renderTiles(lotId, plan, urlOf);
    await apply(plan, crowded, made);
  } catch (err) {
    error = (err as Error).message;
    console.warn(`[photo-fit] ${lotId}: merged photos failed, falling back to solo photos:`, err);
    plan = planFit(pieces, { soloOnly: true });
    await apply(plan, false, new Map());
  }
  const fit: PhotoFitMeta = {
    soloOnly: prev.soloOnly === true,
    at: new Date().toISOString(),
    merged: plan.merged,
    text: crowded ? fitText(plan) : "",
    listed: 1 + plan.tiles.length,
    dropped: plan.dropped,
    error,
  };
  await saveFitMeta(lotId, fit);
  return { ...fit, pieces: pieces.length, scans };
}
