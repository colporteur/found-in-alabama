// Lot Builder (LIST-BUILD): sort one big batch of a single item type (LP
// records, sewing patterns…) that Todd already knows is lot material into
// smaller lots.
//
// The Scans page sends the batch with after: {lotBuild: {key, name, kind, n}}:
// each photo becomes a listing draft (status "sorting") that is piece n of a
// sort session, keeps its own photos for good, and can be given more photos
// from the Lot Builder page (to list it alone, or because one photo wasn't
// enough to tell what it is).
//
// Claude, through the connector (lib/mcp/lot-build-tools.ts), looks at
// numbered contact sheets made with the cover tiler, identifies each piece,
// flags the ones to PULL and sell alone or that NEED A PHOTO, and proposes
// numbered lots shaped by the Expert Guide for the type. Nothing is combined
// until Todd builds a lot from the page: then the pieces merge into a normal
// lot draft (lots.ts: cover from the fronts, fitted to eBay's 24, splittable)
// queued for Claude to write, and pulls are queued as single drafts. Nothing
// here approves, sends to Nifty or publishes.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { renderCover } from "./cover";
import { CLAUDE_STATUS, type McpContent } from "./claude";
import { combineLot, type LotMeta } from "./lots";
import { guidePromptText } from "./rules";
import { matchGuides, preparePhotos } from "./writer";
import {
  checkPlan,
  cleanIdentify,
  cleanPlan,
  lotInstructions,
  needsLook,
  nextLotNo,
  pullInstructions,
  sheetPages,
  LOT_MAX_PIECES,
  SHEET_DEFAULT,
  SHEET_MAX,
  type Verdict,
} from "./lot-build-plan";
import type { LotBuildAfter } from "./validate";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const ints = (list: number[]) => sql.join(list.map((n) => sql`${n}`), sql`, `);

export const SORTING_STATUS = "sorting";

export async function lotBuildReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.lot_build_pieces') IS NOT NULL AS ok`);
  return !!r?.ok;
}

// ─── intake (the Scans page) ─────────────────────────────────────────────────

/** A draft whose photos have all arrived becomes a piece of the sort session
 *  with this key (made on the first piece). Its number is the one the sender
 *  gave (the order in the folder) when that's free, else the next one. */
export async function attachPiece(draftId: string, lb: LotBuildAfter, who: string): Promise<{ buildId: string; n: number }> {
  if (!UUID.test(draftId)) throw new Error("Bad id");
  const [b] = await rows(sql`
    INSERT INTO lot_builds (key, name, kind, created_by) VALUES (${lb.key}, ${lb.name}, ${lb.kind}, ${who})
    ON CONFLICT (key) DO UPDATE SET updated_at = now(), status = 'open', kind = COALESCE(lot_builds.kind, EXCLUDED.kind)
    RETURNING id`);
  const buildId = String(b.id);
  const [have] = await rows(sql`SELECT n FROM lot_build_pieces WHERE draft_id = ${draftId}::uuid`);
  let n = have ? Number(have.n) : 0;
  for (let attempt = 0; !n && attempt < 5; attempt++) {
    const [taken] = lb.n && attempt === 0 ? await rows(sql`SELECT 1 AS x FROM lot_build_pieces WHERE build_id = ${buildId}::uuid AND n = ${lb.n}`) : [{ x: 1 }];
    const [mx] = await rows(sql`SELECT COALESCE(max(n), 0)::int + 1 AS n FROM lot_build_pieces WHERE build_id = ${buildId}::uuid`);
    const want = !taken && lb.n ? lb.n : Number(mx.n);
    const done = await rows(sql`
      INSERT INTO lot_build_pieces (build_id, draft_id, n) VALUES (${buildId}::uuid, ${draftId}::uuid, ${want})
      ON CONFLICT DO NOTHING RETURNING n`);
    if (done.length) n = Number(done[0].n);
  }
  if (!n) throw new Error("Couldn't give this piece a number; send it again.");
  await db.execute(sql`
    UPDATE listing_drafts SET status = ${SORTING_STATUS}, updated_at = now(),
      ai_meta = (COALESCE(ai_meta, '{}'::jsonb) - 'intakeAfter') || jsonb_build_object('lotBuild', jsonb_build_object('buildId', ${buildId}::text, 'n', ${n}::int))
    WHERE id = ${draftId}::uuid AND status IN ('ready', ${SORTING_STATUS})`);
  return { buildId, n };
}

// ─── reading a session ───────────────────────────────────────────────────────

export type BuildPhoto = { id: string; position: number; url: string; role: string | null; name: string | null };
export type BuildPiece = {
  id: string;
  n: number;
  draftId: string;
  state: string;
  identification: string | null;
  estValue: number | null;
  verdict: Verdict | null;
  reason: string | null;
  photoRequest: string | null;
  lotNo: number | null;
  locked: boolean;
  lookedAt: string | null;
  photosSeen: number;
  decidedBy: string | null;
  photos: BuildPhoto[];
  front: string | null;
  /** Never looked at, or Todd added photos since Claude's last look. */
  needsLook: boolean;
};
export type BuildLot = {
  id: string;
  no: number;
  name: string;
  reason: string | null;
  suggestedPrice: number | null;
  guideId: string | null;
  status: string;
  lotDraftId: string | null;
  lotDraftStatus: string | null;
  pieces: number[];
  estTotal: number;
};
export type Build = {
  id: string;
  key: string;
  name: string;
  kind: string | null;
  status: string;
  note: string | null;
  planNote: string | null;
  plannedAt: string | null;
  createdAt: string | null;
  pieces: BuildPiece[];
  lots: BuildLot[];
};

export type BuildSummary = {
  id: string;
  name: string;
  kind: string | null;
  status: string;
  createdAt: string | null;
  pieces: number;
  sorting: number;
  pulls: number;
  needPhoto: number;
  unplaced: number;
  needsLook: number;
  lots: number;
  built: number;
};

export async function listBuilds(includeClosed = false): Promise<BuildSummary[]> {
  const list = await rows(sql`
    SELECT b.id, b.name, b.kind, b.status, b.created_at,
      (SELECT count(*)::int FROM lot_build_pieces p WHERE p.build_id = b.id AND p.state <> 'removed') AS pieces,
      (SELECT count(*)::int FROM lot_build_pieces p WHERE p.build_id = b.id AND p.state = 'sorting') AS sorting,
      (SELECT count(*)::int FROM lot_build_pieces p WHERE p.build_id = b.id AND p.state = 'sorting' AND p.verdict = 'pull') AS pulls,
      (SELECT count(*)::int FROM lot_build_pieces p WHERE p.build_id = b.id AND p.state = 'sorting' AND p.verdict = 'need_photo') AS need_photo,
      (SELECT count(*)::int FROM lot_build_pieces p WHERE p.build_id = b.id AND p.state = 'sorting'
         AND p.lot_no IS NULL AND COALESCE(p.verdict, 'lot') = 'lot') AS unplaced,
      (SELECT count(*)::int FROM lot_build_pieces p WHERE p.build_id = b.id AND p.state = 'sorting' AND (p.looked_at IS NULL OR p.photos_seen <
         (SELECT count(*) FROM draft_photos ph WHERE ph.draft_id = p.draft_id AND ph.uploaded_at IS NOT NULL))) AS needs_look,
      (SELECT count(*)::int FROM lot_build_lots l WHERE l.build_id = b.id AND l.status = 'proposed') AS lots,
      (SELECT count(*)::int FROM lot_build_lots l WHERE l.build_id = b.id AND l.status = 'built') AS built
    FROM lot_builds b ${includeClosed ? sql`` : sql`WHERE b.status = 'open'`}
    ORDER BY b.created_at DESC LIMIT 100`);
  return list.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: (r.kind as string | null) ?? null,
    status: String(r.status),
    createdAt: iso(r.created_at),
    pieces: Number(r.pieces),
    sorting: Number(r.sorting),
    pulls: Number(r.pulls),
    needPhoto: Number(r.need_photo),
    unplaced: Number(r.unplaced),
    needsLook: Number(r.needs_look),
    lots: Number(r.lots),
    built: Number(r.built),
  }));
}

export async function loadBuild(buildId: string): Promise<Build> {
  if (!UUID.test(buildId)) throw new Error("build_id must be an id from lot_build_list");
  const [b] = await rows(sql`SELECT * FROM lot_builds WHERE id = ${buildId}::uuid`);
  if (!b) throw new Error("No such Lot Builder session");
  const ps = await rows(sql`SELECT * FROM lot_build_pieces WHERE build_id = ${buildId}::uuid ORDER BY n`);
  // A piece's photos follow it: on its own draft while sorting, on the lot
  // draft once built (the lot's meta remembers which were its).
  const photos = ps.length
    ? await rows(sql`
        SELECT ph.id, ph.draft_id, ph.position, ph.url, ph.role, ph.original_name FROM draft_photos ph
        WHERE ph.draft_id IN (SELECT draft_id FROM lot_build_pieces WHERE build_id = ${buildId}::uuid AND state IN ('sorting', 'pulled'))
          AND ph.uploaded_at IS NOT NULL AND ph.position < 1000 ORDER BY ph.position`)
    : [];
  const byDraft = new Map<string, BuildPhoto[]>();
  for (const p of photos) {
    const k = String(p.draft_id);
    if (!byDraft.has(k)) byDraft.set(k, []);
    byDraft.get(k)!.push({ id: String(p.id), position: Number(p.position), url: String(p.url), role: p.role == null ? null : String(p.role), name: (p.original_name as string | null) ?? null });
  }
  // Built lots: each piece's photos are on the lot draft now (ai_meta.lot remembers whose).
  const inLot = ps.filter((p) => String(p.state) === "in_lot");
  if (inLot.length) {
    const lotDrafts = await rows(sql`
      SELECT d.ai_meta->'lot'->'parts' AS parts FROM lot_build_lots l JOIN listing_drafts d ON d.id = l.lot_draft_id
      WHERE l.build_id = ${buildId}::uuid AND l.status = 'built'`);
    const owner = new Map<string, string>(); // photo id → piece draft id
    for (const ld of lotDrafts) {
      for (const part of (Array.isArray(ld.parts) ? ld.parts : []) as Array<{ draftId?: string; photos?: Array<{ id: string }> }>) {
        for (const ph of part.photos ?? []) if (part.draftId) owner.set(String(ph.id), String(part.draftId));
      }
    }
    if (owner.size) {
      const found = await rows(sql`
        SELECT id, position, url, role, original_name FROM draft_photos
        WHERE id IN (${sql.join(Array.from(owner.keys()).map((id) => sql`${id}::uuid`), sql`, `)}) AND uploaded_at IS NOT NULL ORDER BY position`);
      for (const p of found) {
        const k = owner.get(String(p.id))!;
        if (!byDraft.has(k)) byDraft.set(k, []);
        byDraft.get(k)!.push({ id: String(p.id), position: Number(p.position), url: String(p.url), role: p.role == null ? null : String(p.role), name: (p.original_name as string | null) ?? null });
      }
    }
  }
  const pieces: BuildPiece[] = ps.map((p) => {
    const list = byDraft.get(String(p.draft_id)) ?? [];
    const front = list.find((x) => x.role === "front") ?? list.find((x) => !["back", "inside", "detail"].includes(x.role ?? "")) ?? list[0] ?? null;
    const lookedAt = iso(p.looked_at);
    const state = String(p.state);
    return {
      id: String(p.id),
      n: Number(p.n),
      draftId: String(p.draft_id),
      state,
      identification: (p.identification as string | null) ?? null,
      estValue: num(p.est_value),
      verdict: (p.verdict as Verdict | null) ?? null,
      reason: (p.reason as string | null) ?? null,
      photoRequest: (p.photo_request as string | null) ?? null,
      lotNo: p.lot_no == null ? null : Number(p.lot_no),
      locked: p.locked === true,
      lookedAt,
      photosSeen: Number(p.photos_seen ?? 0),
      decidedBy: (p.decided_by as string | null) ?? null,
      photos: list,
      front: front?.url ?? null,
      needsLook: needsLook({ lookedAt, photos: list.length, photosSeen: Number(p.photos_seen ?? 0), state }),
    };
  });
  const ls = await rows(sql`
    SELECT l.*, d.status AS draft_status FROM lot_build_lots l LEFT JOIN listing_drafts d ON d.id = l.lot_draft_id
    WHERE l.build_id = ${buildId}::uuid AND l.status <> 'dissolved' ORDER BY l.no`);
  const lots: BuildLot[] = ls.map((l) => {
    const mine = pieces.filter((p) => p.lotNo === Number(l.no) && p.state !== "removed" && p.state !== "pulled" && (p.state === "in_lot" || p.verdict !== "pull"));
    return {
      id: String(l.id),
      no: Number(l.no),
      name: String(l.name),
      reason: (l.reason as string | null) ?? null,
      suggestedPrice: num(l.suggested_price),
      guideId: (l.guide_id as string | null) ?? null,
      status: String(l.status),
      lotDraftId: (l.lot_draft_id as string | null) ?? null,
      lotDraftStatus: (l.draft_status as string | null) ?? null,
      pieces: mine.map((p) => p.n),
      estTotal: Math.round(mine.reduce((a, p) => a + (p.estValue ?? 0), 0) * 100) / 100,
    };
  });
  return {
    id: String(b.id),
    key: String(b.key),
    name: String(b.name),
    kind: (b.kind as string | null) ?? null,
    status: String(b.status),
    note: (b.note as string | null) ?? null,
    planNote: (b.plan_note as string | null) ?? null,
    plannedAt: iso(b.planned_at),
    createdAt: iso(b.created_at),
    pieces,
    lots,
  };
}

async function touch(buildId: string) {
  await db.execute(sql`UPDATE lot_builds SET updated_at = now() WHERE id = ${buildId}::uuid`);
}

// ─── Claude (through the connector) ──────────────────────────────────────────

export const SORT_RULES = `HOW TO SORT THIS BATCH (Todd has already decided it is lot material — the job is to sort it into smaller lots that sell, and to catch what shouldn't be in one):
1. LOOK at every piece. lot_build_sheet shows numbered contact sheets (the number on a tile is the piece number and never changes); lot_build_piece shows one piece's photos full size when a tile is too small to read.
2. SAVE what each piece is with lot_build_identify (many pieces per call): identification = what a buyer would search (for a record: artist, title, label and catalogue number when legible, format), est_value_usd = what it would sell for ALONE (from the Expert Guide's bands — not a guess at retail), and a verdict:
   - "pull": it earns its own listing. Use the Expert Guide's pull triggers (the "pull it" sort, the features that multiply value, anything in its sole-supplier list) or a value alone well above its share of a lot. Say why in reason — Todd sees it as an alert. Missing a pull costs more than a false alarm, but don't pull ordinary pieces: the guide's bands decide.
   - "need_photo": the photo doesn't settle what it is, or whether it's a pull. Say in photo_request exactly what to photograph ("label, side 1", "back cover", "run-out groove etching", "spine"). Todd adds it on the Lot Builder page and the piece comes back to you (needsLook).
   - "lot": everything else.
   Only state what the photos show; one cover photo can't prove a pressing, a grade or a signature's authenticity.
3. PROPOSE LOTS with lot_build_plan once most pieces are identified. Take the lot's TYPE (which themes sell as lots: one artist, one genre, one era, one maker…) and SIZE (pieces per lot, the price ladder by size, shipping weight) from the Expert Guide — name the rule in each lot's reason. Every lot gets a theme a buyer would search for; "assorted" only when the guide says bulk lots are the product. Suggest a lot price from the guide's lot bands. A lot has 2–${LOT_MAX_PIECES} pieces. When the guide has no lot-size data, say so in the plan note and size by theme and shipping weight. Pieces that fit no theme can stay unplaced — say so.
4. Lot numbers are physical piles on Todd's table: keep a lot's number when you revise it (send its "no"), and never reuse one. Pieces Todd placed himself (locked) stay where he put them.
5. Nothing is built from here. Todd reviews the plan on the Lot Builder page, moves pieces, and builds; the lots and pulls then arrive in listing_queue to write as usual (listing_get_draft → listing_save). Tell Todd in your reply: the pulls and why, the pieces that need a photo and which photo, and the lots.`;

export async function claudeBuildList() {
  if (!(await lotBuildReady())) return { sessions: [], note: "The Lot Builder isn't switched on in FIA yet (migration 0055)." };
  const list = await listBuilds();
  return {
    sessions: list.map((b) => ({
      buildId: b.id,
      name: b.name,
      kind: b.kind,
      started: b.createdAt,
      pieces: b.pieces,
      stillSorting: b.sorting,
      waitingForYourLook: b.needsLook,
      pulls: b.pulls,
      needPhoto: b.needPhoto,
      notInALot: b.unplaced,
      lotsProposed: b.lots,
      lotsBuilt: b.built,
    })),
    note: list.length
      ? "Open a session with lot_build_get (text: every piece, the plan so far, the Expert Guide and the sorting rules)."
      : "No open Lot Builder sessions. Todd starts one from the Scans page (\"Send to Lot Builder\").",
  };
}

export async function claudeBuildPacket(buildId: string): Promise<McpContent[]> {
  const b = await loadBuild(buildId);
  const guides = await matchGuides([b.kind, b.name, "lot"].filter(Boolean).join(" ")).catch(() => []);
  const live = b.pieces.filter((p) => p.state === "sorting");
  const line = (p: BuildPiece) =>
    `#${p.n}: ${p.identification ?? "(not identified)"}` +
    (p.estValue != null ? ` · alone ≈ $${p.estValue}` : "") +
    ` · ${p.photos.length} photo${p.photos.length === 1 ? "" : "s"}` +
    (p.verdict === "pull" ? ` · PULL: ${p.reason ?? ""}` : p.verdict === "need_photo" ? ` · NEEDS PHOTO: ${p.photoRequest ?? ""}` : p.lotNo ? ` · lot ${p.lotNo}` : p.verdict === "lot" ? " · lot (not placed)" : "") +
    (p.locked ? " · locked by Todd" : "") +
    (p.needsLook ? (p.lookedAt ? " · NEW PHOTO — look again" : " · not looked at yet") : "");
  const done = b.pieces.filter((p) => p.state !== "sorting" && p.state !== "removed");
  const text = [
    `LOT BUILDER SESSION "${b.name}"${b.kind ? ` — ${b.kind}` : ""} (${b.pieces.filter((p) => p.state !== "removed").length} pieces, ${live.length} still to sort; one photo per piece unless Todd added more).` +
      (b.note ? `\nTodd's note: ${b.note}` : ""),
    SORT_RULES,
    live.length ? `PIECES STILL SORTING:\n${live.map(line).join("\n")}` : "Every piece has been built into a lot or pulled.",
    b.lots.length
      ? `LOTS (numbers are Todd's physical piles):\n${b.lots
          .map(
            (l) =>
              `Lot ${l.no} — ${l.name} [${l.status === "built" ? "BUILT, in the listing queue" : "proposed"}]: ${l.pieces.length} pieces (#${l.pieces.join(", #") || "—"})` +
              `, alone ≈ $${l.estTotal}` +
              (l.suggestedPrice != null ? `, suggested $${l.suggestedPrice}` : "") +
              (l.reason ? ` — ${l.reason}` : "")
          )
          .join("\n")}`
      : "No lots proposed yet.",
    b.planNote ? `Your last plan note: ${b.planNote}` : "",
    done.length ? `Already built or pulled (leave these): #${done.map((p) => p.n).join(", #")}` : "",
    guides.length
      ? `EXPERT GUIDE(S) FOR THIS BATCH — pull triggers, value bands, and lot type and size come from here:\n${guidePromptText(guides.map((g) => ({ id: g.id, name: g.name, content: g.content })), 26_000, 15_000)}\n(Other guides: listing_find_guide with a few words — e.g. a genre or maker once you see what's in the batch, or "lot building" for the lot playbooks.)`
      : `No Expert Guide matched "${b.kind ?? b.name}". Call listing_find_guide with a few words for the item type before sorting; without a guide, be conservative and say so in the plan note.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [{ type: "text", text }];
}

/** Numbered contact sheets of the pieces' fronts (the cover tiler), up to two
 *  sheets a call. */
export async function claudeBuildSheet(buildId: string, from: number, count: number, per: number, only: "all" | "sorting" | "needs_look" = "sorting"): Promise<McpContent[]> {
  const b = await loadBuild(buildId);
  const pool = b.pieces.filter((p) => p.front && p.state !== "removed" && (only === "all" ? true : only === "needs_look" ? p.needsLook : p.state === "sorting"));
  const pages = sheetPages(pool.map((p) => p.n), from, count, per || SHEET_DEFAULT).slice(0, 2);
  if (!pages.length) return [{ type: "text", text: `No pieces from #${Math.max(1, Math.floor(from) || 1)} on (${pool.length} pieces match "${only}").` }];
  const byN = new Map(pool.map((p) => [p.n, p]));
  const out: McpContent[] = [];
  const shown = pages.flat();
  const rest = pool.map((p) => p.n).filter((n) => n > shown[shown.length - 1]);
  out.push({
    type: "text",
    text:
      `Contact sheet${pages.length > 1 ? "s" : ""} of pieces #${shown[0]}–#${shown[shown.length - 1]} (the badge on each tile is the piece number; tiles run left to right, top to bottom). ` +
      (rest.length ? `Next: from=${rest[0]} (${rest.length} more).` : "That's the last of them.") +
      ` A tile too small to read → lot_build_piece.`,
  });
  for (const page of pages) {
    const urls = page.map((n) => byN.get(n)!.front!);
    try {
      const jpg = await renderCover(urls, 1568, { labels: page.map(String), maxTiles: SHEET_MAX });
      out.push({ type: "text", text: `Pieces: #${page.join(", #")}` });
      out.push({ type: "image", mimeType: "image/jpeg", data: jpg.toString("base64") });
    } catch (err) {
      out.push({ type: "text", text: `(Couldn't make the sheet for #${page.join(", #")}: ${(err as Error).message}. Use lot_build_piece for these.)` });
    }
  }
  return out;
}

/** One piece's own photos, full size (up to 8). */
export async function claudeBuildPiece(buildId: string, n: number): Promise<McpContent[]> {
  const b = await loadBuild(buildId);
  const p = b.pieces.find((x) => x.n === Math.floor(n));
  if (!p) throw new Error(`No piece #${n} in this session.`);
  if (!p.photos.length) return [{ type: "text", text: `Piece #${p.n} has no photos on its own draft (${p.state === "in_lot" ? "it's in a built lot — see the lot with listing_get_draft" : p.state}).` }];
  const photos = await preparePhotos(p.photos.slice(0, 8).map((x) => ({ position: x.position, role: x.role, url: x.url })), 1400);
  return [
    {
      type: "text",
      text:
        `Piece #${p.n}: ${p.identification ?? "(not identified)"} — ${p.photos.length} photo${p.photos.length === 1 ? "" : "s"}: ${photos.labels.join(", ")}.` +
        (p.verdict === "need_photo" && p.photoRequest ? ` You asked for: ${p.photoRequest}.` : "") +
        (photos.skipped.length ? ` (Couldn't load: ${photos.skipped.join("; ")})` : ""),
    },
    ...photos.parts.map((part): McpContent => {
      const url = (part as { image_url?: { url?: string } }).image_url?.url ?? "";
      const m = url.match(/^data:([^;]+);base64,(.*)$/);
      return m ? { type: "image", mimeType: m[1], data: m[2] } : { type: "text", text: "(photo missing)" };
    }),
  ];
}

export async function claudeBuildIdentify(buildId: string, input: unknown, who: string) {
  const b = await loadBuild(buildId);
  if (b.status !== "open") throw new Error("Todd closed this session.");
  const { ok, errors } = cleanIdentify(input, new Set(b.pieces.map((p) => p.n)));
  const byN = new Map(b.pieces.map((p) => [p.n, p]));
  const skipped: string[] = [];
  let saved = 0;
  for (const x of ok) {
    const p = byN.get(x.n)!;
    if (p.state !== "sorting") {
      skipped.push(`#${x.n} (${p.state === "in_lot" ? "already in a built lot" : p.state})`);
      continue;
    }
    // Todd's own verdict stands; what the piece IS can still be filled in.
    const verdict = p.locked ? p.verdict : x.verdict ?? p.verdict;
    if (p.locked && x.verdict && x.verdict !== p.verdict) skipped.push(`#${x.n} verdict (Todd set it to ${p.verdict ?? "none"})`);
    const leavesLot = !p.locked && verdict !== "lot" && verdict != null;
    await db.execute(sql`
      UPDATE lot_build_pieces SET
        identification = COALESCE(${x.identification}, identification),
        est_value = COALESCE(${x.estValue}, est_value),
        verdict = ${verdict},
        reason = ${p.locked ? p.reason : x.reason ?? (x.verdict ? null : p.reason)},
        photo_request = ${verdict === "need_photo" ? x.photoRequest ?? p.photoRequest : null},
        lot_no = ${leavesLot ? null : p.lotNo},
        looked_at = now(), photos_seen = ${p.photos.length},
        decided_by = ${p.locked ? p.decidedBy : `claude:${who}`}, updated_at = now()
      WHERE id = ${p.id}::uuid`);
    saved += 1;
  }
  await touch(buildId);
  const after = await loadBuild(buildId);
  const live = after.pieces.filter((p) => p.state === "sorting");
  return {
    saved,
    ...(errors.length ? { errors } : {}),
    ...(skipped.length ? { leftAlone: skipped } : {}),
    stillToLookAt: live.filter((p) => p.needsLook).map((p) => p.n),
    pulls: live.filter((p) => p.verdict === "pull").length,
    needPhoto: live.filter((p) => p.verdict === "need_photo").length,
    note: "Saved for Todd's Lot Builder page. When the pieces are identified, propose lots with lot_build_plan.",
  };
}

export async function claudeBuildPlan(buildId: string, a: Record<string, unknown>, who: string) {
  const b = await loadBuild(buildId);
  if (b.status !== "open") throw new Error("Todd closed this session.");
  const cleaned = cleanPlan(a.lots);
  const allLots = await rows(sql`SELECT no, status FROM lot_build_lots WHERE build_id = ${buildId}::uuid`);
  const check = checkPlan(cleaned.lots, b.pieces, allLots.map((l) => ({ no: Number(l.no), status: String(l.status) })));
  const errors = [...cleaned.errors, ...check.errors];
  if (errors.length) throw new Error(`Plan not saved: ${errors.join("; ")}`);
  if (!check.lots.length && !a.note) throw new Error("Send at least one lot (name + pieces) or a note.");

  const used = allLots.map((l) => Number(l.no));
  const saved: Array<{ no: number; name: string; pieces: number }> = [];
  for (const lot of check.lots) {
    let no = lot.no;
    if (no == null) {
      no = nextLotNo(used);
      used.push(no);
      await db.execute(sql`
        INSERT INTO lot_build_lots (build_id, no, name, reason, suggested_price, guide_id, created_by)
        VALUES (${buildId}::uuid, ${no}, ${lot.name}, ${lot.reason}, ${lot.suggestedPrice}, ${lot.guideId}, ${`claude:${who}`})`);
    } else {
      await db.execute(sql`
        UPDATE lot_build_lots SET name = ${lot.name}, reason = COALESCE(${lot.reason}, reason),
          suggested_price = COALESCE(${lot.suggestedPrice}, suggested_price), guide_id = COALESCE(${lot.guideId}, guide_id),
          status = 'proposed', updated_at = now()
        WHERE build_id = ${buildId}::uuid AND no = ${no}`);
      // A revised lot holds exactly the pieces sent (Todd's own stay).
      await db.execute(sql`
        UPDATE lot_build_pieces SET lot_no = NULL, updated_at = now()
        WHERE build_id = ${buildId}::uuid AND lot_no = ${no} AND state = 'sorting' AND NOT locked
          ${lot.pieces.length ? sql`AND n NOT IN (${ints(lot.pieces)})` : sql``}`);
    }
    if (lot.pieces.length) {
      await db.execute(sql`
        UPDATE lot_build_pieces SET lot_no = ${no}, verdict = 'lot', photo_request = NULL,
          decided_by = ${`claude:${who}`}, updated_at = now()
        WHERE build_id = ${buildId}::uuid AND state = 'sorting' AND n IN (${ints(lot.pieces)})`);
    }
    saved.push({ no, name: lot.name, pieces: lot.pieces.length });
  }
  const note = typeof a.note === "string" && a.note.trim() ? a.note.trim().slice(0, 1500) : null;
  await db.execute(sql`
    UPDATE lot_builds SET plan_note = COALESCE(${note}, plan_note), planned_at = now(), planned_by = ${`claude:${who}`}, updated_at = now()
    WHERE id = ${buildId}::uuid`);
  const after = await loadBuild(buildId);
  const live = after.pieces.filter((p) => p.state === "sorting");
  return {
    lots: saved,
    ...(check.skipped.length ? { leftWhereTheyWere: check.skipped } : {}),
    ...(check.warnings.length ? { warnings: check.warnings } : {}),
    notInALot: live.filter((p) => p.lotNo == null && (p.verdict ?? "lot") === "lot").map((p) => p.n),
    pulls: live.filter((p) => p.verdict === "pull").map((p) => p.n),
    needPhoto: live.filter((p) => p.verdict === "need_photo").map((p) => p.n),
    note: `Plan saved. Todd reviews and builds it at https://www.foundinalabama.com/admin/listings/lot-builder/${buildId} — nothing is combined until he does. Built lots and pulls then show up in listing_queue.`,
  };
}

/** For listing_queue: sessions with pieces waiting for Claude. */
export async function buildsForQueue(): Promise<Array<{ buildId: string; name: string; kind: string | null; pieces: number; waitingForYourLook: number; notInALot: number }>> {
  if (!(await lotBuildReady())) return [];
  return (await listBuilds())
    .filter((b) => b.needsLook > 0 || (b.unplaced > 0 && b.lots === 0))
    .map((b) => ({ buildId: b.id, name: b.name, kind: b.kind, pieces: b.pieces, waitingForYourLook: b.needsLook, notInALot: b.unplaced }));
}

// ─── Todd (the Lot Builder page) ─────────────────────────────────────────────

async function sortingPieces(buildId: string, ns: number[]): Promise<Row[]> {
  const clean = Array.from(new Set(ns.map(Number).filter((n) => Number.isInteger(n) && n >= 1)));
  if (!clean.length) throw new Error("Pick at least one piece.");
  const found = await rows(sql`SELECT * FROM lot_build_pieces WHERE build_id = ${buildId}::uuid AND n IN (${ints(clean)}) AND state = 'sorting'`);
  if (found.length !== clean.length) throw new Error("Some of those pieces aren't waiting to be sorted any more.");
  return found;
}

/** Todd puts pieces in a lot (existing number, or a new lot by name), marks
 *  them to pull / need a photo, or takes them out of their lot. His choices
 *  are locked: Claude's later passes leave them alone. */
export async function placePieces(
  buildId: string,
  ns: number[],
  to: { lotNo?: number | null; newLot?: string | null; verdict?: Verdict | null; note?: string | null },
  who: string
): Promise<{ moved: number; lotNo: number | null }> {
  if (!UUID.test(buildId)) throw new Error("Bad id");
  const ps = await sortingPieces(buildId, ns);
  const list = ps.map((p) => Number(p.n));
  let lotNo: number | null = null;
  if (to.newLot && to.newLot.trim()) {
    const used = (await rows(sql`SELECT no FROM lot_build_lots WHERE build_id = ${buildId}::uuid`)).map((l) => Number(l.no));
    lotNo = nextLotNo(used);
    await db.execute(sql`INSERT INTO lot_build_lots (build_id, no, name, created_by) VALUES (${buildId}::uuid, ${lotNo}, ${to.newLot.trim().slice(0, 120)}, ${who})`);
  } else if (to.lotNo != null) {
    const [l] = await rows(sql`SELECT no FROM lot_build_lots WHERE build_id = ${buildId}::uuid AND no = ${to.lotNo} AND status = 'proposed'`);
    if (!l) throw new Error(`Lot ${to.lotNo} isn't open for pieces (built lots are split from their draft page).`);
    lotNo = Number(l.no);
  }
  if (lotNo != null) {
    const [c] = await rows(sql`SELECT count(*)::int AS n FROM lot_build_pieces WHERE build_id = ${buildId}::uuid AND lot_no = ${lotNo} AND state = 'sorting' AND n NOT IN (${ints(list)})`);
    if (Number(c.n) + list.length > LOT_MAX_PIECES) throw new Error(`A lot holds at most ${LOT_MAX_PIECES} pieces.`);
    await db.execute(sql`
      UPDATE lot_build_pieces SET lot_no = ${lotNo}, verdict = 'lot', photo_request = NULL, locked = true, decided_by = ${who}, updated_at = now()
      WHERE build_id = ${buildId}::uuid AND n IN (${ints(list)}) AND state = 'sorting'`);
  } else if (to.verdict === "pull" || to.verdict === "need_photo") {
    const note = (to.note ?? "").trim().slice(0, 400) || null;
    if (to.verdict === "pull") {
      await db.execute(sql`
        UPDATE lot_build_pieces SET lot_no = NULL, locked = true, decided_by = ${who}, photo_request = NULL,
          reason = COALESCE(${note}, CASE WHEN verdict = 'pull' THEN reason END, 'Todd pulled it'),
          verdict = 'pull', updated_at = now()
        WHERE build_id = ${buildId}::uuid AND n IN (${ints(list)}) AND state = 'sorting'`);
    } else {
      await db.execute(sql`
        UPDATE lot_build_pieces SET locked = true, decided_by = ${who},
          photo_request = COALESCE(${note}, photo_request, 'another photo'), verdict = 'need_photo', updated_at = now()
        WHERE build_id = ${buildId}::uuid AND n IN (${ints(list)}) AND state = 'sorting'`);
    }
  } else {
    // Back to "lot material, not placed".
    await db.execute(sql`
      UPDATE lot_build_pieces SET lot_no = NULL, verdict = 'lot', photo_request = NULL, locked = true, decided_by = ${who}, updated_at = now()
      WHERE build_id = ${buildId}::uuid AND n IN (${ints(list)}) AND state = 'sorting'`);
  }
  await touch(buildId);
  return { moved: list.length, lotNo };
}

/** Let Claude decide these pieces again. */
export async function unlockPieces(buildId: string, ns: number[]): Promise<number> {
  const ps = await sortingPieces(buildId, ns);
  await db.execute(sql`UPDATE lot_build_pieces SET locked = false, updated_at = now() WHERE build_id = ${buildId}::uuid AND n IN (${ints(ps.map((p) => Number(p.n)))})`);
  return ps.length;
}

export async function editLot(buildId: string, no: number, edit: { name?: string | null; suggestedPrice?: number | null; reason?: string | null }): Promise<void> {
  const sets = [sql`updated_at = now()`];
  if (edit.name && edit.name.trim()) sets.push(sql`name = ${edit.name.trim().slice(0, 120)}`);
  if ("suggestedPrice" in edit) sets.push(sql`suggested_price = ${edit.suggestedPrice ?? null}`);
  if ("reason" in edit) sets.push(sql`reason = ${(edit.reason ?? "").trim().slice(0, 600) || null}`);
  await db.execute(sql`UPDATE lot_build_lots SET ${sql.join(sets, sql`, `)} WHERE build_id = ${buildId}::uuid AND no = ${no} AND status = 'proposed'`);
}

/** Break up a proposed lot: its pieces wait unplaced; its number is retired. */
export async function dissolveLot(buildId: string, no: number): Promise<void> {
  const done = await rows(sql`UPDATE lot_build_lots SET status = 'dissolved', updated_at = now() WHERE build_id = ${buildId}::uuid AND no = ${no} AND status = 'proposed' RETURNING id`);
  if (!done.length) throw new Error("Only a lot that hasn't been built can be broken up here.");
  await db.execute(sql`UPDATE lot_build_pieces SET lot_no = NULL, updated_at = now() WHERE build_id = ${buildId}::uuid AND lot_no = ${no} AND state = 'sorting'`);
}

const batchOf = (buildId: string) => `lotbuild-${buildId.slice(0, 8)}`;

async function closeIfDone(buildId: string): Promise<void> {
  await db.execute(sql`
    UPDATE lot_builds SET status = 'closed', updated_at = now() WHERE id = ${buildId}::uuid AND status = 'open'
      AND NOT EXISTS (SELECT 1 FROM lot_build_pieces p WHERE p.build_id = ${buildId}::uuid AND p.state = 'sorting')`);
}

/** Build one proposed lot: its pieces merge into a normal lot draft (the
 *  strongest piece first), queued for Claude to write. */
export async function buildLot(buildId: string, no: number, who: string, opts: { evenIfNeedsPhoto?: boolean } = {}): Promise<{ lotDraftId: string; pieces: number; photos: number }> {
  const b = await loadBuild(buildId);
  const lot = b.lots.find((l) => l.no === no);
  if (!lot || lot.status !== "proposed") throw new Error(`Lot ${no} isn't waiting to be built.`);
  const ps = b.pieces.filter((p) => p.lotNo === no && p.state === "sorting" && p.verdict !== "pull");
  if (ps.length < 2) throw new Error(`Lot ${no} needs at least two pieces.`);
  if (ps.length > LOT_MAX_PIECES) throw new Error(`Lot ${no} has ${ps.length} pieces; a lot holds at most ${LOT_MAX_PIECES}.`);
  const waiting = ps.filter((p) => p.verdict === "need_photo");
  if (waiting.length && !opts.evenIfNeedsPhoto) throw new Error(`Piece${waiting.length === 1 ? "" : "s"} #${waiting.map((p) => p.n).join(", #")} still need a photo. Add it, move the piece out, or build anyway.`);
  if (ps.some((p) => !p.photos.length)) throw new Error("Every piece needs at least one uploaded photo.");
  // Strongest first: the lot is built on it and the cover leads with it.
  const order = [...ps].sort((a, c) => (c.estValue ?? 0) - (a.estValue ?? 0) || a.n - c.n);
  const out = await combineLot(
    order.map((p) => p.draftId),
    who,
    lot.reason ?? `Lot Builder: ${lot.name}`,
    [],
    { buildId, name: lot.name, numbers: new Map(order.map((p) => [p.draftId, p.n])) }
  );
  const note = lotInstructions(lot, b, order);
  await db.execute(sql`
    UPDATE listing_drafts SET status = ${CLAUDE_STATUS}, review_note = ${note}, generation_error = NULL, updated_at = now(),
      ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('claudeQueuedAt', now(), 'claudeQueuedBy', ${who}::text,
        'claudeBatch', ${batchOf(buildId)}::text, 'claudeLots', false,
        'lotBuild', jsonb_build_object('buildId', ${buildId}::text, 'lotNo', ${no}::int, 'suggestedPrice', ${lot.suggestedPrice}::numeric))
    WHERE id = ${out.lotDraftId}::uuid`);
  await db.execute(sql`UPDATE lot_build_lots SET status = 'built', lot_draft_id = ${out.lotDraftId}::uuid, updated_at = now() WHERE id = ${lot.id}::uuid`);
  await db.execute(sql`UPDATE lot_build_pieces SET state = 'in_lot', updated_at = now() WHERE build_id = ${buildId}::uuid AND n IN (${ints(order.map((p) => p.n))})`);
  await closeIfDone(buildId);
  return { lotDraftId: out.lotDraftId, pieces: order.length, photos: out.photos };
}

/** Send pulled pieces on as single drafts for Claude to write (all of the
 *  session's pulls, or just the numbers given). */
export async function sendPulls(buildId: string, ns: number[] | null, who: string): Promise<{ sent: number }> {
  const b = await loadBuild(buildId);
  const ps = b.pieces.filter((p) => p.state === "sorting" && p.verdict === "pull" && (!ns || ns.includes(p.n)));
  if (!ps.length) throw new Error("No pulled pieces to send.");
  let sent = 0;
  for (const p of ps) {
    if (!p.photos.length) continue;
    const done = await rows(sql`
      UPDATE listing_drafts SET status = ${CLAUDE_STATUS}, review_note = ${pullInstructions(p, b)}, generation_error = NULL,
        title_hint = COALESCE(${p.identification}, title_hint), updated_at = now(),
        ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('claudeQueuedAt', now(), 'claudeQueuedBy', ${who}::text,
          'claudeBatch', ${`${batchOf(buildId)}-pulls`}::text, 'claudeLots', false)
      WHERE id = ${p.draftId}::uuid AND status = ${SORTING_STATUS} RETURNING id`);
    if (!done.length) continue;
    await db.execute(sql`UPDATE lot_build_pieces SET state = 'pulled', lot_no = NULL, updated_at = now() WHERE id = ${p.id}::uuid`);
    sent += 1;
  }
  await closeIfDone(buildId);
  return { sent };
}

/** Build every proposed lot that's ready and send every pull. Lots with a
 *  piece still waiting for a photo, or fewer than two pieces, are left. */
export async function buildAll(buildId: string, who: string): Promise<{ built: Array<{ no: number; lotDraftId: string; pieces: number }>; pulls: number; left: string[] }> {
  const b = await loadBuild(buildId);
  const built: Array<{ no: number; lotDraftId: string; pieces: number }> = [];
  const left: string[] = [];
  for (const lot of b.lots.filter((l) => l.status === "proposed")) {
    try {
      const r = await buildLot(buildId, lot.no, who);
      built.push({ no: lot.no, lotDraftId: r.lotDraftId, pieces: r.pieces });
    } catch (err) {
      left.push(`Lot ${lot.no}: ${(err as Error).message}`);
    }
  }
  const pulls = b.pieces.some((p) => p.state === "sorting" && p.verdict === "pull") ? (await sendPulls(buildId, null, who)).sent : 0;
  return { built, pulls, left };
}

/** Take pieces out of the session altogether: they become ordinary Ready
 *  drafts (photos and all). */
export async function releasePieces(buildId: string, ns: number[]): Promise<number> {
  const ps = await sortingPieces(buildId, ns);
  for (const p of ps) {
    await db.execute(sql`
      UPDATE listing_drafts SET status = 'ready', updated_at = now(), ai_meta = COALESCE(ai_meta, '{}'::jsonb) - 'lotBuild'
      WHERE id = ${String(p.draft_id)}::uuid AND status = ${SORTING_STATUS}`);
    await db.execute(sql`UPDATE lot_build_pieces SET state = 'removed', lot_no = NULL, updated_at = now() WHERE id = ${String(p.id)}::uuid`);
  }
  await closeIfDone(buildId);
  return ps.length;
}

export async function updateBuild(buildId: string, edit: { name?: string | null; kind?: string | null; note?: string | null; status?: string | null }): Promise<void> {
  if (!UUID.test(buildId)) throw new Error("Bad id");
  const sets = [sql`updated_at = now()`];
  if (edit.name && edit.name.trim()) sets.push(sql`name = ${edit.name.trim().slice(0, 120)}`);
  if ("kind" in edit) sets.push(sql`kind = ${(edit.kind ?? "").trim().slice(0, 80) || null}`);
  if ("note" in edit) sets.push(sql`note = ${(edit.note ?? "").trim().slice(0, 1500) || null}`);
  if (edit.status === "open" || edit.status === "closed") sets.push(sql`status = ${edit.status}`);
  await db.execute(sql`UPDATE lot_builds SET ${sql.join(sets, sql`, `)} WHERE id = ${buildId}::uuid`);
}

/** "Split lot" on a lot built here (lots.ts): the pieces are sorting again,
 *  still in their lot number, and the lot is proposed again. */
export async function afterSplit(lotDraftId: string, lot: LotMeta): Promise<void> {
  const mine = lot.parts.filter((p) => p.fromBuild);
  if (!mine.length) return;
  const buildId = mine[0].fromBuild!.buildId;
  if (!UUID.test(buildId)) return;
  await db.execute(sql`
    UPDATE lot_build_pieces SET state = 'sorting', updated_at = now()
    WHERE build_id = ${buildId}::uuid AND state = 'in_lot'
      AND draft_id IN (${sql.join(mine.map((p) => sql`${p.draftId}::uuid`), sql`, `)})`);
  await db.execute(sql`UPDATE lot_build_lots SET status = 'proposed', lot_draft_id = NULL, updated_at = now() WHERE build_id = ${buildId}::uuid AND lot_draft_id = ${lotDraftId}::uuid`);
  await db.execute(sql`UPDATE lot_builds SET status = 'open', updated_at = now() WHERE id = ${buildId}::uuid`);
  // The lot draft is the first piece's own draft again.
  const first = lot.parts[0];
  if (first?.fromBuild) {
    await db.execute(sql`
      UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('lotBuild', jsonb_build_object('buildId', ${buildId}::text, 'n', ${first.fromBuild.n}::int))
      WHERE id = ${lotDraftId}::uuid`);
  }
}
