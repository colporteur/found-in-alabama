// POST /api/admin/pinterest/boards/default
// Body: { boardId: string }
// Marks the given board as the default fallback for posting when
// Claude's board_suggestion doesn't match anything.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { setDefaultBoard } from "@/lib/pinterest/api";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { boardId?: string };
  try {
    body = (await req.json()) as { boardId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.boardId) {
    return NextResponse.json({ error: "boardId required" }, { status: 400 });
  }
  await setDefaultBoard(body.boardId);
  return NextResponse.json({ ok: true });
}
