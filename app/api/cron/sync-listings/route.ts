// GET /api/cron/sync-listings — keep the storefront's listings mirror
// fresh. Runs a budgeted, resumable slice of the full eBay store sync
// (see lib/ebay/listing-sync). Vercel Cron calls it every 4 minutes
// during the 09:00 UTC hour (vercel.json) so the whole store gets walked
// across short invocations; once a sweep completes it no-ops until the
// next day.
//
// Auth: same CRON_SECRET pattern as the other crons.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncListingsBudgeted } from "@/lib/ebay/listing-sync";

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
    const result = await syncListingsBudgeted();
    console.log(`[sync-listings] ${JSON.stringify(result)}`);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
