// POST /api/admin/listings/bulk
//   { action: "approve", ids: string[] }  → approve drafts that are complete
//   { action: "writable" }                → ids the "Write all ready" runner works through
// Signed-in admin only. Approval only marks drafts; nothing is published.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { approveDrafts } from "@/lib/listings/review";
import { writableDraftIds } from "@/lib/listings/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; ids?: unknown };
  if (b.action === "approve") {
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    return NextResponse.json({ ok: true, ...(await approveDrafts(ids, session.user.email ?? "admin")) });
  }
  if (b.action === "writable") {
    return NextResponse.json({ ok: true, ids: await writableDraftIds() });
  }
  return NextResponse.json({ error: "action must be approve or writable" }, { status: 400 });
}
