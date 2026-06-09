// GET /api/admin/publer/test
// Verifies the API key + workspace id work by hitting Publer's /users/me.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMe, isConfigured } from "@/lib/publer/api";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Set PUBLER_API_KEY and PUBLER_WORKSPACE_ID in Vercel env vars." },
      { status: 503 }
    );
  }
  try {
    const me = await getMe();
    return NextResponse.json({ ok: true, me });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Test failed" },
      { status: 502 }
    );
  }
}
