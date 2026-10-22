// POST /api/admin/listings/fixes — fix requests for Claude (FIX-1).
// { action: "request", ids: string[], note, topics? }  ask Claude to fix one draft or a batch (one note)
// { action: "cancel" | "accept" | "undo", fixId }        Todd's follow-up on one request
// Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { acceptFix, cancelFix, fixesReady, requestFixes, undoFix } from "@/lib/listings/fixes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await fixesReady())) return NextResponse.json({ error: "Run the migration first (npm run db:migrate)." }, { status: 409 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; ids?: unknown; note?: string; topics?: unknown; fixId?: string };
  try {
    if (b.action === "request") {
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
      const topics = Array.isArray(b.topics) ? b.topics.map(String) : [];
      return NextResponse.json({ ok: true, ...(await requestFixes(ids, String(b.note ?? ""), topics, session.user.email ?? "admin")) });
    }
    const id = String(b.fixId ?? "");
    if (b.action === "cancel") await cancelFix(id);
    else if (b.action === "accept") await acceptFix(id);
    else if (b.action === "undo") await undoFix(id);
    else return NextResponse.json({ error: "unknown action" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
