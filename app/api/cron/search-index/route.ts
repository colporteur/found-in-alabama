// GET /api/cron/search-index — keeps site search current (SEARCH-1):
// rebuilds index rows whose listing text changed, drops sold/ended
// listings, refreshes the "Did you mean" vocabulary, then embeds changed
// listings for meaning search within the time left.
// Auth: CRON_SECRET bearer (Vercel cron) or a signed-in admin.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { embedPending, refreshSearchIndex, searchReady } from "@/lib/search/index";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return true;
  const session = await auth();
  return !!session?.user;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await searchReady())) return NextResponse.json({ skipped: "run the migration (0048) first" });
  try {
    const refreshed = await refreshSearchIndex();
    const embedded = await embedPending(200_000);
    console.log(`[search-index] ${JSON.stringify({ refreshed, embedded })}`);
    return NextResponse.json({ refreshed, embedded });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
