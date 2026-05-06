// POST /api/admin/ebay/oauth/disconnect
// Wipes the stored OAuth tokens. Doesn't actually revoke the grant on
// eBay's side — for that the user goes to their My eBay account settings.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { disconnectOAuth } from "@/lib/ebay/oauth";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  await disconnectOAuth();
  return NextResponse.json({ ok: true });
}
