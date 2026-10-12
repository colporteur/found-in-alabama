// POST /api/admin/listings/bulk
//   { action: "approve", ids: string[] }  → approve drafts that are complete
//   { action: "writable" }                → ids the "Write all ready" runner works through
//   { action: "min_price", ids, min, round87 } → raise prices below the minimum
//   { action: "store_shelf", ids, shelf, keepPlace } → set one of the two store shelves
//   { action: "auto_shelf", ids, parent, keepPlace, slot? } → AI picks the subcategory of `parent` (≤25 per call)
//   { action: "unapprove", ids }        → approved (not yet in Nifty) → back to review
// Signed-in admin only. Approval only marks drafts; nothing is published.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { approveDrafts, unapproveDraft } from "@/lib/listings/review";
import { writableDraftIds, writerSettings } from "@/lib/listings/writer";
import { raiseMinPrice } from "@/lib/listings/drafts";
import { autoShelf, setStoreShelf } from "@/lib/listings/bulk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    action?: string;
    ids?: unknown;
    min?: unknown;
    round87?: unknown;
    shelf?: unknown;
    keepPlace?: unknown;
    parent?: unknown;
    slot?: unknown;
  };
  if (b.action === "auto_shelf") {
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    const slot = b.slot === 0 || b.slot === 1 ? b.slot : undefined;
    try {
      return NextResponse.json({ ok: true, ...(await autoShelf(ids, String(b.parent ?? ""), { keepPlace: b.keepPlace !== false, slot })) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }
  if (b.action === "store_shelf") {
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    try {
      return NextResponse.json({ ok: true, ...(await setStoreShelf(ids, String(b.shelf ?? ""), b.keepPlace !== false)) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }
  if (b.action === "min_price") {
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    try {
      const s = await writerSettings();
      return NextResponse.json({ ok: true, ...(await raiseMinPrice(ids, Number(b.min), { round87: b.round87 !== false, poshmarkFloor: s.poshmarkFloor })) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }
  if (b.action === "approve") {
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    return NextResponse.json({ ok: true, ...(await approveDrafts(ids, session.user.email ?? "admin")) });
  }
  if (b.action === "unapprove") {
    const ids = (Array.isArray(b.ids) ? b.ids.map(String) : []).slice(0, 300);
    let unapproved = 0;
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      const r = await unapproveDraft(id);
      if (r.ok) unapproved++;
      else skipped.push({ id, reason: "not approved (or already in Nifty)" });
    }
    return NextResponse.json({ ok: true, unapproved, skipped });
  }
  if (b.action === "writable") {
    return NextResponse.json({ ok: true, ids: await writableDraftIds() });
  }
  return NextResponse.json({ error: "action must be approve or writable" }, { status: 400 });
}
