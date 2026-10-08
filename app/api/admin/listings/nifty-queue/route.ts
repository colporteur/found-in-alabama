// GET /api/admin/listings/nifty-queue — approved drafts waiting to go to
// Nifty, with everything the extension's "Send approved to Nifty" needs
// (content, photo URLs, eBay category path, specifics, store categories and
// the Nifty template item to copy settings from). API key or session.

import { NextRequest, NextResponse } from "next/server";
import { listingCaller } from "@/lib/listings/auth";
import { niftyQueue } from "@/lib/listings/nifty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const who = await listingCaller(req);
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 25));
  return NextResponse.json({ ok: true, items: await niftyQueue(limit) });
}
