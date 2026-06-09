// POST /api/admin/publer/accounts/sync
// Pulls accounts from Publer and refreshes the publer_accounts cache.
// Preserves any existing channel mappings.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncAccountsToCache } from "@/lib/publer/api";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const count = await syncAccountsToCache();
    return NextResponse.json({ ok: true, accountCount: count });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 502 }
    );
  }
}
