// POST /api/admin/listings/:id/lot { action: "split" }
// Undo a lot Claude combined: photos go back to their drafts, the set-aside
// drafts return to Ready, and this one starts over as its first piece.
// { action: "arrange", solo?: number[], rebuild?: boolean }
// A whole-folder lot (lib/listings/folder-lot.ts): choose which pieces get
// their own listed photo (the grid is rebuilt from the rest); rebuild also
// redraws the numbered overview (after turning a photo).
// { action: "keep_open" } / { action: "close" }   hold a lot open for more pieces / stop
// { action: "add", draftIds: string[] }           add pieces to this open lot
// (lib/listings/open-lots.ts).
// { action: "photo_fit", soloOnly?: boolean }      re-fit the lot's photos into eBay's 24;
// soloOnly turns merged photos off (lib/listings/photo-fit.ts). Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { splitLot } from "@/lib/listings/lots";
import { addToLot, closeLot, keepLotOpen } from "@/lib/listings/open-lots";
import { arrangeFolderLot, folderLotOf } from "@/lib/listings/folder-lot";
import { fitLotPhotos } from "@/lib/listings/photo-fit";
import { ROTATABLE } from "@/lib/listings/photos";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: unknown; solo?: unknown; rebuild?: unknown; draftIds?: unknown; soloOnly?: unknown };
  const who = session.user.email ?? "admin";
  if (b.action === "keep_open" || b.action === "close" || b.action === "add") {
    try {
      if (b.action === "keep_open") {
        await keepLotOpen(params.id, who);
        return NextResponse.json({ ok: true });
      }
      if (b.action === "close") return NextResponse.json({ ok: true, ...(await closeLot(params.id)) });
      const ids = Array.isArray(b.draftIds) ? b.draftIds.map(String) : [];
      return NextResponse.json({ ok: true, ...(await addToLot(params.id, ids, who)) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
  }
  if (b.action === "photo_fit") {
    try {
      const [d] = ((await db.execute(sql`SELECT status, ai_meta FROM listing_drafts WHERE id = ${params.id}::uuid`)) as {
        rows?: Array<{ status: string; ai_meta: Record<string, unknown> | null }>;
      }).rows ?? [];
      if (!d) throw new Error("No such draft");
      if (!ROTATABLE.includes(String(d.status))) throw new Error(`Photos can't change once a draft is "${String(d.status).replace("_", " ")}".`);
      if (typeof b.soloOnly === "boolean") {
        await db.execute(sql`
          UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb)
            || jsonb_build_object('photoFit', COALESCE(ai_meta->'photoFit', '{}'::jsonb) || jsonb_build_object('soloOnly', ${b.soloOnly}::boolean))
          WHERE id = ${params.id}::uuid`);
      }
      if (folderLotOf(d.ai_meta)) return NextResponse.json({ ok: true, ...(await arrangeFolderLot(params.id, null, who)) });
      if (!d.ai_meta?.lot) throw new Error("This draft isn't a lot.");
      return NextResponse.json({ ok: true, ...(await fitLotPhotos(params.id)) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
  }
  if (b.action === "arrange") {
    try {
      const [d] = ((await db.execute(sql`SELECT status FROM listing_drafts WHERE id = ${params.id}::uuid`)) as { rows?: Array<{ status: string }> }).rows ?? [];
      if (!d) throw new Error("No such draft");
      if (!ROTATABLE.includes(String(d.status))) throw new Error(`Photos can't change once a draft is "${String(d.status).replace("_", " ")}".`);
      const solo = Array.isArray(b.solo) ? b.solo.map(Number).filter(Number.isInteger) : null;
      const out = await arrangeFolderLot(params.id, solo, session.user.email ?? "admin", { rebuildCover: b.rebuild === true });
      return NextResponse.json({ ok: true, ...out });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
  }
  if (b.action !== "split") return NextResponse.json({ error: 'action must be "split", "arrange" or "photo_fit"' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await splitLot(params.id)) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
