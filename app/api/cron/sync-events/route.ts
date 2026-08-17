// GET /api/cron/sync-events — fast freshness pass for the listings
// mirror. One GetSellerEvents call pulls everything that changed since
// the last run (sold, ended, price/qty revised) and patches the mirror,
// so the storefronts drop sold items within ~15 minutes instead of
// waiting for the daily full sweep (see /api/cron/sync-listings).
//
// Auth: same CRON_SECRET pattern as the other crons.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncListingEventsDelta } from "@/lib/ebay/events-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return true;
  const session = await auth();
  return !!session?.user;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncListingEventsDelta();
    console.log(`[sync-events] ${JSON.stringify(result)}`);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Events sync failed" },
      { status: 500 }
    );
  }
}
