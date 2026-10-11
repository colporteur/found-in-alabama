// POST /api/admin/listings/ebay-publish { enabled } — the pilot switch.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { setEbayPublishEnabled } from "@/lib/ebay/publish";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to the admin" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  await setEbayPublishEnabled(b.enabled === true);
  return NextResponse.json({ ok: true, enabled: b.enabled === true });
}
