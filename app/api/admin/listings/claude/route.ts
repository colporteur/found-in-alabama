// POST /api/admin/listings/claude — "Write with Claude" queue.
//   { action: "send", ids: string[], note?, lots? }  → queue drafts for Claude
//   { action: "send_ready", note?, lots? }           → queue every ready draft
//   lots: true = Claude may combine pieces of this batch into lots
//   { action: "take_back", id }               → back to Ready / Review
// Signed-in admin only. Claude writes them through the FIA connector;
// nothing is approved or published.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { readyDraftIds, sendToClaude, takeBackFromClaude } from "@/lib/listings/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const who = session.user.email ?? "admin";
  const b = (await req.json().catch(() => ({}))) as { action?: string; ids?: unknown; id?: unknown; note?: unknown; lots?: unknown };
  const note = typeof b.note === "string" ? b.note : null;
  const lots = b.lots === true;
  if (b.action === "send") {
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    return NextResponse.json({ ok: true, ...(await sendToClaude(ids, who, note, lots)) });
  }
  if (b.action === "send_ready") {
    return NextResponse.json({ ok: true, ...(await sendToClaude(await readyDraftIds(), who, note, lots)) });
  }
  if (b.action === "take_back") {
    const ok = await takeBackFromClaude(String(b.id ?? ""));
    return NextResponse.json(ok ? { ok: true } : { ok: false, error: "Not waiting for Claude" }, { status: ok ? 200 : 409 });
  }
  return NextResponse.json({ error: "action must be send, send_ready or take_back" }, { status: 400 });
}
