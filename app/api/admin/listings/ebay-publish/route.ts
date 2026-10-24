// POST /api/admin/listings/ebay-publish { enabled?, cardsDirect? } — the
// straight-to-eBay switches (publish-settings.ts).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveEbaySettings } from "@/lib/ebay/publish-settings";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to the admin" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { enabled?: unknown; cardsDirect?: unknown };
  const s = await saveEbaySettings({
    ...(typeof b.enabled === "boolean" ? { enabled: b.enabled } : {}),
    ...(typeof b.cardsDirect === "boolean" ? { cardsDirect: b.cardsDirect } : {}),
  });
  return NextResponse.json({ ok: true, ...s });
}
