// Lot pool (LIST-POOL): pieces waiting to become part of a lot.
//
//   pooled    — a listing draft set aside (draft status "pooled", bin LOTPOOL,
//               not for sale anywhere). From the draft page, the Scans page,
//               or Claude (listing_pool_add) when a piece has no partner yet.
//   candidate — an item still listed on its own (stale inventory). It must
//               be delisted on every marketplace by hand (for now) and
//               confirmed here before its lot can be listed.
//
// Groups are lots being formed. Postcards stay with postcards unless the
// group allows mixing. "List this lot now" builds one lot draft (photos
// re-pointed, a cover from each piece's front) and queues it for Claude to
// write; it then goes through Review like any draft. lib/listings/lots.ts's
// splitLot puts a pool lot back into the pool.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { frontOf, insertCoverRow, loadPhotos, lotOrder, placePhotos, uploadCover, type LotMeta } from "./lots";
import { fitLotPhotos } from "./photo-fit";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (list: string[]) => sql.join(list.map((id) => sql`${id}::uuid`), sql`, `);
export const POOL_BIN = "LOTPOOL";
export const POOLED_STATUS = "pooled";
/** Drafts that can be set aside into the pool. */
const POOLABLE = ["ready", "review", "sent_back", "with_claude"];
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export async function poolReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.lot_pool') IS NOT NULL AS ok`);
  return !!r?.ok;
}

/** Pure: does this look like a postcard? (identification kind, category, words) */
export function looksLikePostcard(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => !!t && /\b(post\s?cards?|rppc|real photo postcard|linen card)\b/i.test(t));
}

/** Pure: postcards stay with postcards unless the group allows mixing. */
export function mixProblem(members: Array<{ isPostcard: boolean }>, allowMix: boolean): string | null {
  if (allowMix || members.length < 2) return null;
  const pc = members.filter((m) => m.isPostcard).length;
  return pc > 0 && pc < members.length
    ? "This lot would mix postcards with other things. Turn on \"allow mixing\" for the lot first."
    : null;
}

// ─── reading ─────────────────────────────────────────────────────────────────

export type PoolMember = {
  id: string;
  kind: "pooled" | "candidate";
  draftId: string | null;
  registryItemId: string | null;
  groupId: string | null;
  title: string | null;
  identification: string | null;
  isPostcard: boolean;
  estValue: number | null;
  photoUrl: string | null;
  note: string | null;
  prevBin: string | null;
  moved: boolean;
  delisted: boolean;
  addedAt: string;
  days: number;
  /** candidate: where it's still listed (venue → url) */
  venues: Array<{ venue: string; url: string | null; status: string }>;
};
/** Pure: a forming lot worth listing — 3+ pieces, or 2+ worth $15+ together. */
export const READY_RULE = "3 or more pieces, or 2+ pieces worth $15 or more together";
export function lotReady(pieces: number, estTotal: number): boolean {
  return pieces >= 3 || (pieces >= 2 && estTotal >= 15);
}

export type PoolGroup = {
  id: string;
  /** Meets READY_RULE (Todd still decides). */
  ready: boolean;
  name: string;
  allowMix: boolean;
  suggestedPrice: number | null;
  reason: string | null;
  members: PoolMember[];
  estTotal: number;
  oldestDays: number;
};

export async function loadPool(): Promise<{ groups: PoolGroup[]; loose: PoolMember[]; toMove: PoolMember[] }> {
  const mem = await rows(sql`
    SELECT p.*, EXTRACT(EPOCH FROM (now() - p.added_at)) / 86400 AS days,
           COALESCE(p.photo_url,
             (SELECT ph.url FROM draft_photos ph WHERE ph.draft_id = p.draft_id AND ph.uploaded_at IS NOT NULL ORDER BY ph.position LIMIT 1)) AS photo,
           (SELECT COALESCE(json_agg(json_build_object('venue', v.venue, 'url', v.url, 'status', v.status) ORDER BY v.venue), '[]'::json)
              FROM venue_listings v WHERE p.kind = 'candidate' AND v.registry_item_id = p.registry_item_id AND v.status IN ('live', 'listed')) AS venues
    FROM lot_pool p WHERE p.status = 'waiting' ORDER BY p.added_at`);
  const members: PoolMember[] = mem.map((m) => ({
    id: String(m.id),
    kind: String(m.kind) === "candidate" ? "candidate" : "pooled",
    draftId: m.draft_id ? String(m.draft_id) : null,
    registryItemId: m.registry_item_id ? String(m.registry_item_id) : null,
    groupId: m.group_id ? String(m.group_id) : null,
    title: (m.title as string | null) ?? null,
    identification: (m.identification as string | null) ?? null,
    isPostcard: m.is_postcard === true,
    estValue: num(m.est_value),
    photoUrl: (m.photo as string | null) ?? null,
    note: (m.note as string | null) ?? null,
    prevBin: (m.prev_bin as string | null) ?? null,
    moved: m.moved_at != null,
    delisted: m.delisted_at != null,
    addedAt: String(m.added_at),
    days: Math.floor(Number(m.days ?? 0)),
    venues: Array.isArray(m.venues) ? (m.venues as PoolMember["venues"]) : [],
  }));
  const grp = await rows(sql`SELECT * FROM lot_groups WHERE status = 'forming' ORDER BY created_at`);
  const groups: PoolGroup[] = grp.map((g) => {
    const ms = members.filter((m) => m.groupId === String(g.id));
    const estTotal = Math.round(ms.reduce((s, m) => s + (m.estValue ?? 0), 0) * 100) / 100;
    return {
      id: String(g.id),
      ready: lotReady(ms.length, estTotal),
      name: String(g.name),
      allowMix: g.allow_mix === true,
      suggestedPrice: num(g.suggested_price),
      reason: (g.reason as string | null) ?? null,
      members: ms,
      estTotal,
      oldestDays: Math.max(0, ...ms.map((m) => m.days)),
    };
  });
  const grouped = new Set(groups.map((g) => g.id));
  return {
    groups,
    loose: members.filter((m) => !m.groupId || !grouped.has(m.groupId)),
    toMove: members.filter((m) => m.kind === "pooled" && !m.moved),
  };
}

/** For the Listings page: lots that meet READY_RULE, and still-listed
 *  candidates waiting in the pool. */
export async function poolSummary(): Promise<{ readyLots: number; readyNames: string[]; candidates: number }> {
  if (!(await poolReady())) return { readyLots: 0, readyNames: [], candidates: 0 };
  const g = await rows(sql`
    SELECT g.name, count(p.id)::int AS n, COALESCE(sum(p.est_value), 0)::float AS est
    FROM lot_groups g JOIN lot_pool p ON p.group_id = g.id AND p.status = 'waiting'
    WHERE g.status = 'forming' GROUP BY g.id, g.name ORDER BY min(p.added_at)`);
  const ready = g.filter((r) => lotReady(Number(r.n), Number(r.est)));
  const [c] = await rows(sql`SELECT count(*)::int AS n FROM lot_pool WHERE status = 'waiting' AND kind = 'candidate'`);
  return { readyLots: ready.length, readyNames: ready.map((r) => String(r.name)), candidates: Number(c?.n ?? 0) };
}

export async function poolCount(): Promise<number> {
  if (!(await poolReady())) return 0;
  const [r] = await rows(sql`SELECT count(*)::int AS n FROM lot_pool WHERE status = 'waiting'`);
  return Number(r?.n ?? 0);
}

// ─── adding ──────────────────────────────────────────────────────────────────

async function groupFor(opts: { groupId?: string | null; newGroup?: string | null }, who: string): Promise<string | null> {
  if (opts.groupId && UUID.test(opts.groupId)) {
    const [g] = await rows(sql`SELECT id FROM lot_groups WHERE id = ${opts.groupId}::uuid AND status = 'forming'`);
    if (!g) throw new Error("That lot isn't forming any more.");
    return String(g.id);
  }
  const name = (opts.newGroup ?? "").trim().slice(0, 120);
  if (!name) return null;
  const [g] = await rows(sql`INSERT INTO lot_groups (name, created_by) VALUES (${name}, ${who}) RETURNING id`);
  return String(g.id);
}

async function checkMix(groupId: string, adding: Array<{ isPostcard: boolean }>): Promise<void> {
  const [g] = await rows(sql`SELECT allow_mix FROM lot_groups WHERE id = ${groupId}::uuid`);
  const cur = await rows(sql`SELECT is_postcard FROM lot_pool WHERE group_id = ${groupId}::uuid AND status = 'waiting'`);
  const problem = mixProblem([...cur.map((c) => ({ isPostcard: c.is_postcard === true })), ...adding], g?.allow_mix === true);
  if (problem) throw new Error(problem);
}

/** Set a draft aside in the pool (bin LOTPOOL, not for sale). */
export async function poolDraft(
  draftId: string,
  who: string,
  opts: { identification?: string | null; estValue?: number | null; isPostcard?: boolean | null; note?: string | null; groupId?: string | null; newGroup?: string | null } = {}
): Promise<{ memberId: string; groupId: string | null }> {
  if (!UUID.test(draftId)) throw new Error("Bad draft id");
  const [d] = await rows(sql`
    SELECT id, status, title, title_hint, bin_sku, price, registry_item_id, ebay_category_name, ai_meta FROM listing_drafts WHERE id = ${draftId}::uuid`);
  if (!d) throw new Error("No such draft");
  if (!POOLABLE.includes(String(d.status))) throw new Error(`A "${String(d.status).replace("_", " ")}" draft can't go into the lot pool.`);
  if ((d.ai_meta as Record<string, unknown> | null)?.lot) throw new Error("This draft is already a lot.");
  const meta = (d.ai_meta ?? {}) as Record<string, unknown>;
  const ident = (meta.identification as { identification?: string; kind?: string; est_value_usd?: number } | null) ?? null;
  const title = (d.title as string | null) ?? (d.title_hint as string | null) ?? null;
  const isPostcard = opts.isPostcard ?? (ident?.kind === "postcard" || looksLikePostcard(title, d.ebay_category_name as string | null));
  const groupId = await groupFor(opts, who);
  if (groupId) await checkMix(groupId, [{ isPostcard }]);
  const [m] = await rows(sql`
    INSERT INTO lot_pool (kind, draft_id, registry_item_id, group_id, title, identification, is_postcard, est_value, note, prev_bin, added_by)
    VALUES ('pooled', ${draftId}::uuid, ${(d.registry_item_id as string | null) ?? null}::uuid, ${groupId}::uuid, ${title},
            ${opts.identification ?? ident?.identification ?? null}, ${isPostcard},
            ${opts.estValue ?? ident?.est_value_usd ?? num(d.price)}::numeric, ${opts.note ?? null},
            ${(d.bin_sku as string | null) ?? null}, ${who})
    RETURNING id`);
  await db.execute(sql`
    UPDATE listing_drafts SET status = ${POOLED_STATUS}, bin_sku = ${POOL_BIN}, updated_at = now() WHERE id = ${draftId}::uuid`);
  if (d.registry_item_id) {
    await db.execute(sql`UPDATE registry_items SET bin_sku = ${POOL_BIN}, updated_at = now() WHERE id = ${String(d.registry_item_id)}::uuid AND status = 'draft'`);
  }
  return { memberId: String(m.id), groupId };
}

/** Suggest an item that's still listed on its own (stale inventory). */
export async function addCandidate(
  registryItemId: string,
  who: string,
  opts: { note?: string | null; groupId?: string | null; newGroup?: string | null } = {}
): Promise<{ memberId: string; groupId: string | null }> {
  if (!UUID.test(registryItemId)) throw new Error("Bad item id");
  const [r] = await rows(sql`
    SELECT r.id, r.status, r.title, r.primary_ebay_item_id, e.price, e.primary_image_url, e.site_category_name
    FROM registry_items r LEFT JOIN ebay_listings e ON e.item_id = r.primary_ebay_item_id
    WHERE r.id = ${registryItemId}::uuid`);
  if (!r) throw new Error("No such item");
  if (String(r.status) !== "live") throw new Error("Only an item that's live can be suggested for a lot.");
  const isPostcard = looksLikePostcard(r.title as string | null, r.site_category_name as string | null);
  const groupId = await groupFor(opts, who);
  if (groupId) await checkMix(groupId, [{ isPostcard }]);
  const [m] = await rows(sql`
    INSERT INTO lot_pool (kind, registry_item_id, group_id, title, is_postcard, est_value, photo_url, note, added_by)
    VALUES ('candidate', ${registryItemId}::uuid, ${groupId}::uuid, ${(r.title as string | null) ?? null}, ${isPostcard},
            ${num(r.price)}::numeric, ${(r.primary_image_url as string | null) ?? null}, ${opts.note ?? null}, ${who})
    RETURNING id`);
  return { memberId: String(m.id), groupId };
}

// ─── changing ────────────────────────────────────────────────────────────────

/** Take a piece out of the pool: a pooled draft goes back to Ready/Review in
 *  its old bin; a candidate simply stays listed. */
export async function releaseMember(memberId: string): Promise<{ note: string | null }> {
  const [m] = await rows(sql`SELECT * FROM lot_pool WHERE id = ${memberId}::uuid AND status = 'waiting'`);
  if (!m) throw new Error("That piece isn't waiting in the pool.");
  await db.execute(sql`UPDATE lot_pool SET status = 'released', group_id = NULL, updated_at = now() WHERE id = ${memberId}::uuid`);
  if (String(m.kind) === "pooled" && m.draft_id) {
    const bin = (m.prev_bin as string | null) ?? null;
    await db.execute(sql`
      UPDATE listing_drafts SET status = CASE WHEN written_by IS NULL THEN 'ready' ELSE 'review' END,
        bin_sku = ${bin}, updated_at = now()
      WHERE id = ${String(m.draft_id)}::uuid AND status = ${POOLED_STATUS}`);
    if (m.registry_item_id) {
      await db.execute(sql`UPDATE registry_items SET bin_sku = ${bin}, updated_at = now() WHERE id = ${String(m.registry_item_id)}::uuid AND status = 'draft'`);
    }
    return { note: bin ? `Back to its own listing; it goes back in bin ${bin}.` : "Back to its own listing; give it a bin when you list it." };
  }
  return { note: m.delisted_at ? "You'd marked it delisted — relist it on its own if you want it for sale again." : null };
}

export async function assignMembers(memberIds: string[], target: { groupId?: string | null; newGroup?: string | null } | null, who: string): Promise<{ groupId: string | null; moved: number }> {
  const clean = memberIds.filter((id) => UUID.test(id)).slice(0, 50);
  if (!clean.length) throw new Error("Pick at least one piece.");
  const ms = await rows(sql`SELECT id, is_postcard FROM lot_pool WHERE id IN (${ids(clean)}) AND status = 'waiting'`);
  if (!target) {
    await db.execute(sql`UPDATE lot_pool SET group_id = NULL, updated_at = now() WHERE id IN (${ids(clean)}) AND status = 'waiting'`);
    return { groupId: null, moved: ms.length };
  }
  const groupId = await groupFor(target, who);
  if (!groupId) throw new Error("Pick a lot or give a new one a name.");
  const [g] = await rows(sql`SELECT allow_mix FROM lot_groups WHERE id = ${groupId}::uuid`);
  const stay = await rows(sql`SELECT is_postcard FROM lot_pool WHERE group_id = ${groupId}::uuid AND status = 'waiting' AND id NOT IN (${ids(clean)})`);
  const problem = mixProblem([...stay, ...ms].map((x) => ({ isPostcard: x.is_postcard === true })), g?.allow_mix === true);
  if (problem) throw new Error(problem);
  await db.execute(sql`UPDATE lot_pool SET group_id = ${groupId}::uuid, updated_at = now() WHERE id IN (${ids(clean)}) AND status = 'waiting'`);
  await db.execute(sql`UPDATE lot_groups SET updated_at = now() WHERE id = ${groupId}::uuid`);
  // Lots emptied by the move (a merge) stop showing.
  await db.execute(sql`
    UPDATE lot_groups g SET status = 'dissolved', updated_at = now()
    WHERE g.status = 'forming' AND g.id <> ${groupId}::uuid
      AND NOT EXISTS (SELECT 1 FROM lot_pool x WHERE x.group_id = g.id AND x.status = 'waiting')
      AND EXISTS (SELECT 1 FROM lot_pool y WHERE y.group_id = g.id)`);
  return { groupId, moved: ms.length };
}

export async function updateGroup(groupId: string, edit: { name?: string; allowMix?: boolean; suggestedPrice?: number | null; reason?: string | null }): Promise<void> {
  if (!UUID.test(groupId)) throw new Error("Bad lot id");
  if (edit.allowMix === false) {
    const cur = await rows(sql`SELECT is_postcard FROM lot_pool WHERE group_id = ${groupId}::uuid AND status = 'waiting'`);
    const problem = mixProblem(cur.map((c) => ({ isPostcard: c.is_postcard === true })), false);
    if (problem) throw new Error("This lot already mixes postcards with other things; take some out first.");
  }
  const sets = [sql`updated_at = now()`];
  if (edit.name != null && edit.name.trim()) sets.push(sql`name = ${edit.name.trim().slice(0, 120)}`);
  if (edit.allowMix != null) sets.push(sql`allow_mix = ${edit.allowMix}`);
  if (edit.suggestedPrice !== undefined) sets.push(sql`suggested_price = ${edit.suggestedPrice}::numeric`);
  if (edit.reason !== undefined) sets.push(sql`reason = ${edit.reason ? edit.reason.slice(0, 600) : null}`);
  await db.execute(sql`UPDATE lot_groups SET ${sql.join(sets, sql`, `)} WHERE id = ${groupId}::uuid AND status = 'forming'`);
}

export async function dissolveGroup(groupId: string): Promise<void> {
  await db.execute(sql`UPDATE lot_pool SET group_id = NULL, updated_at = now() WHERE group_id = ${groupId}::uuid AND status = 'waiting'`);
  await db.execute(sql`UPDATE lot_groups SET status = 'dissolved', updated_at = now() WHERE id = ${groupId}::uuid AND status = 'forming'`);
}

export async function markMoved(memberIds: string[]): Promise<number> {
  const clean = memberIds.filter((id) => UUID.test(id));
  if (!clean.length) return 0;
  const done = await rows(sql`UPDATE lot_pool SET moved_at = now(), updated_at = now() WHERE id IN (${ids(clean)}) AND moved_at IS NULL RETURNING id`);
  return done.length;
}

export async function confirmDelisted(memberId: string, done: boolean): Promise<void> {
  await db.execute(sql`
    UPDATE lot_pool SET delisted_at = ${done ? sql`now()` : sql`NULL`}, updated_at = now()
    WHERE id = ${memberId}::uuid AND kind = 'candidate' AND status = 'waiting'`);
}

// ─── listing a lot ───────────────────────────────────────────────────────────

/** Turn a forming lot into one lot draft queued for Claude to write. */
export async function listGroup(groupId: string, who: string): Promise<{ lotDraftId: string; pieces: number }> {
  if (!UUID.test(groupId)) throw new Error("Bad lot id");
  const [g] = await rows(sql`SELECT * FROM lot_groups WHERE id = ${groupId}::uuid AND status = 'forming'`);
  if (!g) throw new Error("That lot isn't forming any more.");
  const ms = await rows(sql`SELECT * FROM lot_pool WHERE group_id = ${groupId}::uuid AND status = 'waiting' ORDER BY kind DESC, added_at`);
  if (ms.length < 2) throw new Error("A lot needs at least two pieces.");
  const notDelisted = ms.filter((m) => String(m.kind) === "candidate" && !m.delisted_at);
  if (notDelisted.length)
    throw new Error(
      `First delist ${notDelisted.length === 1 ? "this piece" : "these pieces"} on every marketplace and tick "delisted everywhere": ${notDelisted
        .map((m) => m.title ?? "item")
        .join("; ")}`
    );
  const pooled = ms.filter((m) => String(m.kind) === "pooled" && m.draft_id);
  const cands = ms.filter((m) => String(m.kind) === "candidate");

  // The lot draft: the first pooled piece's draft, or a new one.
  let lotId: string;
  let regId: string | null;
  if (pooled.length) {
    lotId = String(pooled[0].draft_id);
    const [d] = await rows(sql`SELECT registry_item_id FROM listing_drafts WHERE id = ${lotId}::uuid`);
    regId = (d?.registry_item_id as string | null) ?? null;
  } else {
    const title = `Lot: ${String(g.name)}`.slice(0, 300);
    const [r] = await rows(sql`
      INSERT INTO registry_items (status, title, title_normalized, created_from) VALUES ('draft', ${title}, ${title.toLowerCase()}, 'intake') RETURNING id`);
    regId = String(r.id);
    const [d] = await rows(sql`
      INSERT INTO listing_drafts (registry_item_id, status, source, source_label, facts, title_hint, quantity, created_by)
      VALUES (${regId}::uuid, ${POOLED_STATUS}, 'manual', ${`Lot pool: ${String(g.name)}`}, '{}'::jsonb, ${title}, 1, ${who})
      RETURNING id`);
    lotId = String(d.id);
  }

  // Candidates bring their eBay photos (first 4) onto the lot draft.
  const candPhotoIds: string[][] = [];
  let tmp = 3000;
  for (const c of cands) {
    const [e] = await rows(sql`
      SELECT e.image_urls, e.primary_image_url FROM registry_items r JOIN ebay_listings e ON e.item_id = r.primary_ebay_item_id
      WHERE r.id = ${String(c.registry_item_id)}::uuid`);
    const urls = (Array.isArray(e?.image_urls) ? (e!.image_urls as unknown[]).map(String) : []).filter(Boolean);
    if (!urls.length && (e?.primary_image_url || c.photo_url)) urls.push(String(e?.primary_image_url ?? c.photo_url));
    const got: string[] = [];
    for (const [i, u] of urls.slice(0, 4).entries()) {
      const [ph] = await rows(sql`
        INSERT INTO draft_photos (draft_id, position, role, storage_key, url, original_name, content_type, uploaded_at)
        VALUES (${lotId}::uuid, ${tmp++}, ${i === 0 ? "front" : "other"}, ${`external:${String(c.id)}:${i}:${Date.now().toString(36)}`},
                ${u}, ${`listing photo ${i + 1}`}, 'image/jpeg', now())
        RETURNING id`);
      got.push(String(ph.id));
    }
    candPhotoIds.push(got);
  }

  const pooledPhotos = await loadPhotos(pooled.map((p) => String(p.draft_id)));
  const perPooled = pooled.map((p) => pooledPhotos.filter((x) => x.draftId === String(p.draft_id)));
  const lotPhotos = await loadPhotos([lotId]);
  const perCand = candPhotoIds.map((list) => lotPhotos.filter((x) => list.includes(x.id)));
  const parts = [...perPooled, ...perCand];
  // Everything on the lot; fitLotPhotos lays it into eBay's 24 once the lot is saved.
  const { keep, park } = lotOrder(parts, Number.MAX_SAFE_INTEGER);
  const fronts = parts.map(frontOf).filter((p): p is NonNullable<typeof p> => !!p);
  const urlRows = fronts.length ? await rows(sql`SELECT id, url FROM draft_photos WHERE id IN (${ids(fronts.map((f) => f.id))})`) : [];
  const urlOf = new Map(urlRows.map((u) => [String(u.id), String(u.url)]));
  const cover = await uploadCover(lotId, fronts.map((f) => urlOf.get(f.id)!).filter(Boolean));

  // Extras that don't fit eBay's 24 wait on another pooled piece's draft
  // (candidate extras are just dropped — they're copies of eBay photos).
  // (Every pooled photo gets a new place, so none collides with the lot's
  // new positions; with no other pooled draft, extras wait on the lot itself
  // at 1001+ and FIA flags it.)
  const parkOn = pooled.find((p) => String(p.draft_id) !== lotId);
  const pooledIds = new Set(perPooled.flat().map((x) => x.id));
  const parkPooled = park.filter((p) => pooledIds.has(p.id));
  const dropCand = park.filter((p) => !pooledIds.has(p.id));
  await placePhotos([
    ...keep.map((p, i) => ({ id: p.id, draftId: lotId, position: i + 2 })),
    ...parkPooled.map((p, i) => ({ id: p.id, draftId: parkOn ? String(parkOn.draft_id) : lotId, position: 1001 + i })),
  ]);
  if (dropCand.length) await db.execute(sql`DELETE FROM draft_photos WHERE id IN (${ids(dropCand.map((p) => p.id))}) AND storage_key LIKE 'external:%'`);
  const coverId = await insertCoverRow(lotId, cover, 1);

  const candText = await Promise.all(
    cands.map(async (c) => {
      const [e] = await rows(sql`
        SELECT e.title, e.description FROM registry_items r JOIN ebay_listings e ON e.item_id = r.primary_ebay_item_id WHERE r.id = ${String(c.registry_item_id)}::uuid`);
      const desc = String(e?.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
      return `- ${String(e?.title ?? c.title ?? "item")}${desc ? `: ${desc}` : ""}`;
    })
  );
  const lotMeta: LotMeta = {
    parts: [
      ...pooled.map((p, i) => ({
        draftId: String(p.draft_id),
        title: (p.title as string | null) ?? null,
        bin: (p.prev_bin as string | null) ?? null,
        photos: perPooled[i].map((x) => ({ id: x.id, position: x.position })),
      })),
      ...cands.map((c, i) => ({
        draftId: "",
        title: (c.title as string | null) ?? null,
        bin: null,
        photos: perCand[i].map((x) => ({ id: x.id, position: x.position })),
        candidate: { registryItemId: String(c.registry_item_id), memberId: String(c.id) },
      })),
    ],
    coverPhotoId: coverId,
    combinedAt: new Date().toISOString(),
    combinedBy: who,
    reason: (g.reason as string | null) ?? null,
    poolGroupId: groupId,
    poolMemberIds: ms.map((m) => String(m.id)),
  };
  const price = num(g.suggested_price);
  const est = ms.reduce((s, m) => s + (num(m.est_value) ?? 0), 0);
  const note = [
    `Lot from the lot pool: "${String(g.name)}" — ${ms.length} pieces.`,
    price ? `Todd's suggested lot price: $${price.toFixed(2)}.` : est ? `The pieces' estimates add up to $${est.toFixed(2)}; price the lot for the lot.` : "",
    cands.length ? `Some pieces were listed on their own before; their old listing text:\n${candText.join("\n")}` : "",
    "There's no bin yet — Todd assigns one in Review.",
  ]
    .filter(Boolean)
    .join("\n");
  const hint = `Lot of ${ms.length}: ${lotMeta.parts.map((p) => p.title ?? "item").join(" + ")}`.slice(0, 300);
  await db.execute(sql`
    UPDATE listing_drafts SET status = 'with_claude', bin_sku = NULL, title_hint = ${hint}, quantity = 1, review_note = ${note},
      generation_error = NULL, updated_at = now(),
      ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('lot', ${JSON.stringify(lotMeta)}::jsonb,
        'claudeQueuedAt', now(), 'claudeQueuedBy', ${who}::text, 'claudeLots', false)
    WHERE id = ${lotId}::uuid`);
  if (regId) await db.execute(sql`UPDATE registry_items SET bin_sku = NULL, updated_at = now() WHERE id = ${regId}::uuid AND status = 'draft'`);
  await fitLotPhotos(lotId).catch((err) => console.warn(`[pool] ${lotId}: fitting photos failed:`, err));
  for (const p of pooled.slice(1)) {
    await db.execute(sql`
      UPDATE listing_drafts SET status = 'discarded', review_note = ${`combined into a lot (${lotId})`},
        ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('combinedInto', ${lotId}::text), updated_at = now()
      WHERE id = ${String(p.draft_id)}::uuid`);
    if (p.registry_item_id) await db.execute(sql`UPDATE registry_items SET status = 'archived', updated_at = now() WHERE id = ${String(p.registry_item_id)}::uuid AND status = 'draft'`);
  }
  for (const c of cands) {
    // Delisted by hand; it's now part of the lot.
    await db.execute(sql`
      UPDATE registry_items SET status = 'archived', notes = concat_ws(E'\n', notes, ${`In lot draft ${lotId} (lot pool)`}), updated_at = now()
      WHERE id = ${String(c.registry_item_id)}::uuid AND status = 'live'`);
  }
  await db.execute(sql`UPDATE lot_pool SET status = 'in_lot', updated_at = now() WHERE id IN (${ids(ms.map((m) => String(m.id)))})`);
  await db.execute(sql`UPDATE lot_groups SET status = 'listed', lot_draft_id = ${lotId}::uuid, updated_at = now() WHERE id = ${groupId}::uuid`);
  return { lotDraftId: lotId, pieces: ms.length };
}
