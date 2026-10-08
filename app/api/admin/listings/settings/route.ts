// GET/PUT /api/admin/listings/settings — the listing writer's models per
// tier, photo count, retry threshold and price floors (app_settings
// "listingWriter"). Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveWriterSettings, writerSettings } from "@/lib/listings/writer";
import { DEFAULT_WRITER_SETTINGS } from "@/lib/listings/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, settings: await writerSettings(), defaults: DEFAULT_WRITER_SETTINGS });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  return NextResponse.json({ ok: true, settings: await saveWriterSettings(b) });
}
