// GET /api/cron/hip-map — refresh the hip_listings map (Hip id ↔ eBay
// item id) by walking the store's active listings, then (Phase HIP-2)
// reconcile: close on Hip whatever the eBay mirror says is sold out.
// Run once after the API key lands (with ?reconcile=0 the first time,
// to look at the map before anything is closed), then daily from the
// sync-listings workflow. Same CRON_SECRET / signed-in-admin auth.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { reconcileHipAgainstMirror, refreshHipListingMap } from "@/lib/hip/listings";

export const runtime = "nodejs";
export const maxDuration = 120;
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
    const refresh = await refreshHipListingMap();
    // Phase HIP-2: with a fresh map, close anything on Hip that eBay says
    // is sold out. ?reconcile=0 skips it (e.g. the very first map pull).
    const doReconcile = req.nextUrl.searchParams.get("reconcile") !== "0";
    const reconcile = doReconcile ? await reconcileHipAgainstMirror() : null;
    const result = { refresh, reconcile };
    console.log(`[hip-map] ${JSON.stringify(result)}`);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Hip map refresh failed" },
      { status: 500 }
    );
  }
}
