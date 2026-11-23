// POST /api/admin/listings/lot-builder — the Lot Builder (lib/listings/lot-build.ts).
//   { action: "place", buildId, pieces: [n…], lotNo? | newLot? | verdict?: "pull" | "need_photo", note? }
//        (none of lotNo / newLot / verdict = take the pieces out of their lot)
//   { action: "carry", buildId, fromBuildId | toBuildId, pieces?, lotNo? }   leftovers between sessions
//   { action: "unlock", buildId, pieces }          let Claude decide them again
//   { action: "release", buildId, pieces }         out of the session → ordinary Ready drafts
//   { action: "lot", buildId, no, name?, suggestedPrice?, reason? }
//   { action: "dissolve", buildId, no }
//   { action: "build", buildId, no, evenIfNeedsPhoto? }   → lot draft, queued for Claude
//   { action: "pulls", buildId, pieces? }                 → pulled pieces queued as singles
//   { action: "build_all", buildId }
//   { action: "session", buildId, name?, kind?, note?, status?: "open" | "closed" }
// Preview Mode sessions (lot_builds.mode = "preview") also take:
//   place with verdict "pool" | "discard"
//   { action: "pool", buildId, pieces? }       → "pool" pieces into the lot pool (bin LOTPOOL)
//   { action: "discard", buildId, pieces? }    → "discard" pieces set aside as discarded drafts
//   { action: "apply", buildId }               → build ready lots, send singles, pool, discard
// Signed-in admin only. Nothing is approved or published from here.
// GET (admin or the PC sender's API key): { ready, preview } — the Scans page
// asks before sending a batch, so an FIA without the tables (or without
// Preview Mode's column, migration 0057) is never sent to.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listingCaller } from "@/lib/listings/auth";
import {
  applyPreview,
  carryOver,
  buildAll,
  discardPieces,
  poolPieces,
  previewReady,
  buildLot,
  dissolveLot,
  editLot,
  lotBuildReady,
  placePieces,
  releasePieces,
  sendPulls,
  unlockPieces,
  updateBuild,
} from "@/lib/listings/lot-build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Building a lot makes its cover and merged photos (dozens of scans).
export const maxDuration = 300;

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : []);

export async function GET(req: NextRequest) {
  const who = await listingCaller(req);
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ready = await lotBuildReady();
  return NextResponse.json({ ok: true, ready, preview: ready && (await previewReady()) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await lotBuildReady())) return NextResponse.json({ error: "Run npm run db:migrate first (migration 0055)." }, { status: 409 });
  const who = session.user.email ?? "admin";
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const buildId = String(b.buildId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(buildId)) return NextResponse.json({ error: "Bad session id" }, { status: 400 });
  try {
    switch (b.action) {
      case "place": {
        const verdict = b.verdict === "pull" || b.verdict === "need_photo" || b.verdict === "pool" || b.verdict === "discard" ? b.verdict : null;
        const lotNo = Number.isInteger(b.lotNo) ? (b.lotNo as number) : null;
        return NextResponse.json({ ok: true, ...(await placePieces(buildId, nums(b.pieces), { lotNo, newLot: s(b.newLot), verdict, note: s(b.note) }, who)) });
      }
      case "carry": {
        // Bring pieces INTO this session from another (fromBuildId), or send
        // this session's pieces to another (toBuildId). No pieces = every leftover.
        const other = String(b.fromBuildId ?? b.toBuildId ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(other)) return NextResponse.json({ error: "Bad session id" }, { status: 400 });
        const list = Array.isArray(b.pieces) ? nums(b.pieces) : null;
        // lotNo: straight into that lot of the session they are going to.
        const into = Number.isInteger(b.lotNo) ? (b.lotNo as number) : null;
        const out = b.fromBuildId ? await carryOver(other, list, buildId, who, into) : await carryOver(buildId, list, other, who, into);
        return NextResponse.json({ ok: true, ...out });
      }
      case "unlock":
        return NextResponse.json({ ok: true, unlocked: await unlockPieces(buildId, nums(b.pieces)) });
      case "release":
        return NextResponse.json({ ok: true, released: await releasePieces(buildId, nums(b.pieces)) });
      case "lot": {
        const price = b.suggestedPrice === null || b.suggestedPrice === "" ? null : Number(b.suggestedPrice);
        await editLot(buildId, Number(b.no), {
          name: s(b.name),
          ...("suggestedPrice" in b ? { suggestedPrice: price != null && Number.isFinite(price) && price > 0 ? price : null } : {}),
          ...("reason" in b ? { reason: s(b.reason) } : {}),
        });
        return NextResponse.json({ ok: true });
      }
      case "dissolve":
        await dissolveLot(buildId, Number(b.no));
        return NextResponse.json({ ok: true });
      case "build":
        return NextResponse.json({ ok: true, ...(await buildLot(buildId, Number(b.no), who, { evenIfNeedsPhoto: b.evenIfNeedsPhoto === true })) });
      case "pulls":
        return NextResponse.json({ ok: true, ...(await sendPulls(buildId, Array.isArray(b.pieces) ? nums(b.pieces) : null, who)) });
      case "build_all":
        return NextResponse.json({ ok: true, ...(await buildAll(buildId, who)) });
      case "pool":
        return NextResponse.json({ ok: true, ...(await poolPieces(buildId, Array.isArray(b.pieces) ? nums(b.pieces) : null, who)) });
      case "discard":
        return NextResponse.json({ ok: true, ...(await discardPieces(buildId, Array.isArray(b.pieces) ? nums(b.pieces) : null, who)) });
      case "apply":
        return NextResponse.json({ ok: true, ...(await applyPreview(buildId, who)) });
      case "session":
        await updateBuild(buildId, {
          name: s(b.name),
          ...("kind" in b ? { kind: s(b.kind) } : {}),
          ...("note" in b ? { note: s(b.note) } : {}),
          status: s(b.status),
        });
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
