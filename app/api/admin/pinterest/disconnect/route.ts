// POST /api/admin/pinterest/disconnect
// Wipes the stored tokens. Cached boards stay in place — they're useful
// for review and get rebuilt on next connect.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { disconnectOAuth } from "@/lib/pinterest/oauth";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await disconnectOAuth();
  return NextResponse.json({ ok: true });
}
