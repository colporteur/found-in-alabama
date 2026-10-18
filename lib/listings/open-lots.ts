// Open lots (LOT-OPEN): Todd marks a lot draft "Keep lot open" when he knows
// more pieces that belong in it are on their way. The lot leaves Review and
// waits (status lot_open). Every time Claude works the queue it sees the open
// lots and can add queued pieces that belong (listing_add_to_lot); Todd can
// add a piece himself from its draft page. Adding pieces closes the lot:
// photos go in item by item, the cover is rebuilt from every piece's front,
// the added drafts are set aside like any combine, and the lot goes back to
// Claude to rewrite for all its pieces. Todd presses "Keep lot open" again if
// still more are coming. Only unpublished lot drafts can be open.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { COVER_MAX_TILES } from "./cover";
import { CLAUDE_STATUS } from "./claude";
import { frontOf, insertCoverRow, loadPhotos, lotOrder, placePhotos, uploadCover, type LotMeta, type LotPart } from "./lots";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTOS = 24;
const PARK_FROM = 1001;

export const OPEN_STATUS = "lot_open";
/** Lots that can be held open (not approved, not sent anywhere). */
export const OPENABLE = ["ready", "review", "sent_back", CLAUDE_STATUS];
/** Pieces Todd can add by hand / Claude can add from its queue. */
const ADDABLE_BY_TODD = ["ready", "review", "sent_back", CLAUDE_STATUS];
/** Nudge Todd about lots open this long. */
export const OPEN_NUDGE_DAYS = 21;

export type LotOpenMeta = { since: string; by: string; prevStatus: string };
type P = { id: string; draftId: string; position: number; role: string | null };

async function loadLot(id: string): Promise<{ d: Row; lot: LotMeta; meta: Record<string, unknown> }> {
  if (!UUID.test(id)) throw new Error("Bad lot id");
  const [d] = await rows(sql`SELECT id, status, title, title_hint, bin_sku, ai_meta FROM listing_drafts WHERE id = ${id}::uuid`);
  if (!d) throw new Error("No such draft");
  const meta = (d.ai_meta ?? {}) as Record<string, unknown>;
  const lot = meta.lot as LotMeta | undefined;
  if (!lot?.parts?.length) throw new Error("Only a lot can be kept open (this draft isn't one).");
  return { d, lot, meta };
}

export async function keepLotOpen(id: string, who: string): Promise<void> {
  const { d } = await loadLot(id);
  const st = String(d.status);
  if (st === OPEN_STATUS) return;
  if (!OPENABLE.includes(st)) throw new Error(`Only a lot that isn't approved or listed yet can be kept open (this one is "${st.replace("_", " ")}").`);
  const open: LotOpenMeta = { since: new Date().toISOString(), by: who, prevStatus: st };
  await db.execute(sql`
    UPDATE listing_drafts SET status = ${OPEN_STATUS}, updated_at = now(),
      ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('lotOpen', ${JSON.stringify(open)}::jsonb)
    WHERE id = ${id}::uuid`);
}

/** Todd closes an open lot without adding anything: back where it was. */
export async function closeLot(id: string): Promise<{ status: string }> {
  const { d, meta } = await loadLot(id);
  if (String(d.status) !== OPEN_STATUS) throw new Error("This lot isn't open.");
  const prev = (meta.lotOpen as LotOpenMeta | undefined)?.prevStatus;
  const status = prev && OPENABLE.includes(prev) ? prev : d.title ? "review" : "ready";
  await db.execute(sql`
    UPDATE listing_drafts SET status = ${status}, updated_at = now(), ai_meta = COALESCE(ai_meta, '{}'::jsonb) - 'lotOpen'
    WHERE id = ${id}::uuid`);
  return { status };
}

/** Pure: the photo lists per part of an existing lot (ordered by where each
 *  photo was on its own draft), from the lot's record and the rows found. */
export function existingParts(lot: LotMeta, found: Map<string, P>): P[][] {
  return lot.parts.map((part) =>
    part.photos
      .map((x) => {
        const f = found.get(x.id);
        return f ? { ...f, position: x.position } : null;
      })
      .filter((x): x is P => !!x)
  );
}

export async function addToLot(
  lotId: string,
  draftIds: string[],
  who: string,
  opts: { reason?: string | null; byClaude?: boolean } = {}
): Promise<{ lotDraftId: string; added: number; pieces: number; photos: number; parked: number; note: string }> {
  const { d: lotRow, lot, meta } = await loadLot(lotId);
  if (String(lotRow.status) !== OPEN_STATUS)
    throw new Error("That lot isn't open for more pieces (Todd opens a lot with \"Keep lot open\" on its page).");
  const ids = Array.from(new Set(draftIds.filter((x) => UUID.test(x) && x !== lotId)));
  if (!ids.length) throw new Error("Give at least one draft id to add.");
  if (lot.parts.some((p) => ids.includes(p.draftId))) throw new Error("One of those pieces is already in this lot.");
  if (lot.parts.length + ids.length > COVER_MAX_TILES) throw new Error(`A lot can have at most ${COVER_MAX_TILES} pieces (this one has ${lot.parts.length}).`);

  const found = await rows(sql`
    SELECT id, status, title, title_hint, bin_sku, registry_item_id, ai_meta FROM listing_drafts
    WHERE id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})`);
  if (found.length !== ids.length) throw new Error("One of those ids isn't a draft.");
  const allowed = opts.byClaude ? [CLAUDE_STATUS] : ADDABLE_BY_TODD;
  const byId = new Map(found.map((r) => [String(r.id), r]));
  const adding = ids.map((x) => byId.get(x)!);
  for (const a of adding) {
    const m = (a.ai_meta ?? {}) as Record<string, unknown>;
    if (!allowed.includes(String(a.status)))
      throw new Error(
        opts.byClaude
          ? `Draft ${a.id} isn't waiting in your queue, so you can't add it.`
          : `Draft ${a.id} is "${String(a.status).replace("_", " ")}"; only drafts not yet approved can go in a lot.`
      );
    if (m.lot || m.folderLot) throw new Error(`Draft ${a.id} is a lot itself.`);
  }

  // Photos: the lot's pieces (wherever their photos sit now) + the new ones.
  const known = lot.parts.flatMap((p) => p.photos.map((x) => x.id));
  const knownRows = known.length
    ? await rows(sql`
        SELECT id, draft_id, position, role FROM draft_photos
        WHERE id IN (${sql.join(known.map((x) => sql`${x}::uuid`), sql`, `)}) AND uploaded_at IS NOT NULL`)
    : [];
  const foundP = new Map(
    knownRows.map((p) => [String(p.id), { id: String(p.id), draftId: String(p.draft_id), position: Number(p.position), role: p.role == null ? null : String(p.role) }])
  );
  const parts = existingParts(lot, foundP);
  // Photos on the lot that belong to no piece: FIA's old covers go; anything
  // else (Todd's own additions) stays with the first piece.
  const onLot = await rows(sql`
    SELECT id, position, role, storage_key FROM draft_photos WHERE draft_id = ${lotId}::uuid AND uploaded_at IS NOT NULL ORDER BY position`);
  const knownSet = new Set(known);
  const oldCovers = onLot.filter((p) => !knownSet.has(String(p.id)) && (String(p.id) === lot.coverPhotoId || (String(p.role) === "cover" && /\/cover\//.test(String(p.storage_key)))));
  const extras = onLot
    .filter((p) => !knownSet.has(String(p.id)) && !oldCovers.includes(p))
    .map((p, i) => ({ id: String(p.id), draftId: lotId, position: 900 + i, role: p.role == null ? null : String(p.role) }));
  if (parts.length) parts[0] = [...parts[0], ...extras];
  const newPhotos = await loadPhotos(ids);
  const newParts = ids.map((x) => newPhotos.filter((p) => p.draftId === x));
  if (newParts.some((ps) => !ps.length)) throw new Error("Every piece added needs at least one uploaded photo.");
  const all = [...parts, ...newParts];

  const { keep, park } = lotOrder(all, MAX_PHOTOS - 1);
  const fronts = all.map(frontOf).filter((p): p is P => !!p);
  const urls = await rows(sql`SELECT id, url FROM draft_photos WHERE id IN (${sql.join(fronts.map((f) => sql`${f.id}::uuid`), sql`, `)})`);
  const urlOf = new Map(urls.map((u) => [String(u.id), String(u.url)]));
  const cover = await uploadCover(lotId, fronts.map((f) => urlOf.get(f.id)!).filter(Boolean));

  if (oldCovers.length) {
    await db.execute(sql`DELETE FROM draft_photos WHERE draft_id = ${lotId}::uuid
      AND id IN (${sql.join(oldCovers.map((p) => sql`${String(p.id)}::uuid`), sql`, `)})`);
  }
  // Extras that don't fit wait on a set-aside piece (never listed).
  const parkOn = [...lot.parts.map((p) => p.draftId), ...ids].find((x) => x && x !== lotId) ?? lotId;
  await placePhotos([
    ...keep.map((p, i) => ({ id: p.id, draftId: lotId, position: i + 2 })),
    ...park.map((p, i) => ({ id: p.id, draftId: parkOn, position: PARK_FROM + i })),
  ]);
  const coverId = await insertCoverRow(lotId, cover, 1);

  const addedParts: LotPart[] = adding.map((a, i) => ({
    draftId: String(a.id),
    title: (a.title as string | null) ?? (a.title_hint as string | null) ?? null,
    bin: (a.bin_sku as string | null) ?? null,
    photos: newParts[i].map((p) => ({ id: p.id, position: p.position })),
    addedOpen: true,
  }));
  const reason = (opts.reason ?? "").trim().slice(0, 600) || null;
  const history = [
    ...(((lot as unknown as { additions?: unknown[] }).additions ?? []) as unknown[]),
    { at: new Date().toISOString(), by: who, pieces: addedParts.map((p) => p.title ?? "item"), reason },
  ];
  const newLot: LotMeta = { ...lot, parts: [...lot.parts, ...addedParts], coverPhotoId: coverId, additions: history } as LotMeta;
  const n = newLot.parts.length;
  const hint = `Lot of ${n}: ${newLot.parts.map((p) => p.title ?? "item").join(" + ")}`.slice(0, 300);
  const note =
    `${addedParts.length} piece${addedParts.length === 1 ? " was" : "s were"} added to this open lot (${addedParts.map((p) => p.title ?? "item").join("; ")}). ` +
    `Rewrite the whole listing for all ${n} pieces — title, description (each piece in turn), item specifics and a price for the lot.`;
  const nextMeta = { ...meta, lot: newLot };
  delete (nextMeta as Record<string, unknown>).lotOpen;
  await db.execute(sql`
    UPDATE listing_drafts SET status = ${CLAUDE_STATUS}, title_hint = ${hint}, quantity = 1, review_note = ${note},
      ai_meta = ${JSON.stringify(nextMeta)}::jsonb, updated_at = now()
    WHERE id = ${lotId}::uuid`);
  for (const a of adding) {
    await db.execute(sql`
      UPDATE listing_drafts SET status = 'discarded', review_note = ${`added to an open lot (${lotId})`},
        ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('combinedInto', ${lotId}::text),
        updated_at = now()
      WHERE id = ${String(a.id)}::uuid`);
    if (a.registry_item_id) {
      await db.execute(sql`UPDATE registry_items SET status = 'archived', updated_at = now() WHERE id = ${String(a.registry_item_id)} AND status = 'draft'`);
    }
  }
  return {
    lotDraftId: lotId,
    added: addedParts.length,
    pieces: n,
    photos: keep.length + 1,
    parked: park.length,
    note:
      `Added. The lot now has ${n} pieces, a new cover from every front, and is closed again. It's back in your queue: ` +
      `call listing_get_draft with ${lotId} and write it for all ${n} pieces with listing_save.` +
      (park.length ? ` ${park.length} photo(s) didn't fit eBay's 24 and were left out of the listing.` : ""),
  };
}

/** Open lots, for the queue (Claude) and the Listings page (Todd). */
export async function openLots(): Promise<Array<{ id: string; title: string; pieces: string[]; reason: string | null; since: string | null; days: number; fromPool: boolean }>> {
  const list = await rows(sql`
    SELECT id, title, title_hint, ai_meta, updated_at FROM listing_drafts WHERE status = ${OPEN_STATUS} ORDER BY updated_at`);
  return list.map((r) => {
    const meta = (r.ai_meta ?? {}) as Record<string, unknown>;
    const lot = meta.lot as LotMeta | undefined;
    const since = (meta.lotOpen as LotOpenMeta | undefined)?.since ?? null;
    return {
      id: String(r.id),
      title: String(r.title ?? r.title_hint ?? "Lot"),
      pieces: (lot?.parts ?? []).map((p) => p.title ?? "item"),
      reason: lot?.reason ?? null,
      since,
      days: since ? Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000) : 0,
      fromPool: !!lot?.poolGroupId,
    };
  });
}
