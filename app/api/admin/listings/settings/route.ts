// GET/PUT /api/admin/listings/settings — the listing writer's models per
// tier, photo count, retry threshold and price floors (app_settings
// "listingWriter"). Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveWriterSettings, writerSettings } from "@/lib/listings/writer";
import { DEFAULT_WRITER_SETTINGS } from "@/lib/listings/rules";
import { niftyTemplates, saveNiftyTemplates, DEFAULT_TEMPLATES } from "@/lib/listings/nifty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    ok: true,
    settings: await writerSettings(),
    defaults: DEFAULT_WRITER_SETTINGS,
    niftyTemplates: await niftyTemplates(),
    niftyTemplateDefaults: DEFAULT_TEMPLATES,
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const body = b as Record<string, unknown>;
  const templates = body.niftyTemplates ? await saveNiftyTemplates(body.niftyTemplates) : undefined;
  const settings = body.models || body.identifyModel ? await saveWriterSettings(b) : await writerSettings();
  return NextResponse.json({ ok: true, settings, niftyTemplates: templates ?? (await niftyTemplates()) });
}
