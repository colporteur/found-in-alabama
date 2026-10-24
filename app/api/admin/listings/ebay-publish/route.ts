// POST /api/admin/listings/ebay-publish
//   { enabled?, cardsDirect? }          the straight-to-eBay switches
//   { action: "fixCardShipping" }       move FIA-listed single cards onto the
//                                       shipping policy their price calls for
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveEbaySettings } from "@/lib/ebay/publish-settings";
import { fixCardShipping } from "@/lib/ebay/publish";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to the admin" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { enabled?: unknown; cardsDirect?: unknown; action?: unknown };
  if (b.action === "fixCardShipping") {
    try {
      return NextResponse.json({ ok: true, ...(await fixCardShipping(session.user.email ?? "admin")) });
    } catch (err) {
      return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
    }
  }
  const s = await saveEbaySettings({
    ...(typeof b.enabled === "boolean" ? { enabled: b.enabled } : {}),
    ...(typeof b.cardsDirect === "boolean" ? { cardsDirect: b.cardsDirect } : {}),
  });
  return NextResponse.json({ ok: true, ...s });
}
