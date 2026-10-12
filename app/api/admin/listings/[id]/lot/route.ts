// POST /api/admin/listings/:id/lot { action: "split" }
// Undo a lot Claude combined: photos go back to their drafts, the set-aside
// drafts return to Ready, and this one starts over as its first piece.
// Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { splitLot } from "@/lib/listings/lots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: unknown };
  if (b.action !== "split") return NextResponse.json({ error: 'action must be "split"' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await splitLot(params.id)) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
