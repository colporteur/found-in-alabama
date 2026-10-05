// POST /api/admin/email/import — adopt address rules that already exist in
// Cloudflare Email Routing. Read-only toward Cloudflare.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { importFromCloudflare } from "@/lib/email/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await importFromCloudflare()) });
}
