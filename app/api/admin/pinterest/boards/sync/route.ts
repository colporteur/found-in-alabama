// POST /api/admin/pinterest/boards/sync
// Refreshes pinterest_boards from the live API.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncBoardsToCache } from "@/lib/pinterest/api";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const count = await syncBoardsToCache();
    return NextResponse.json({ ok: true, boardCount: count });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 502 }
    );
  }
}
