// GET /api/cron/hip-publish — Phase HIP-3 publisher (TES pool → HipPostcard).
//
//   ?dry=1        plan only: counts by Hip category, exclusions, review
//                 reasons. Default whenever HIP_PUBLISH_ENABLED isn't "1".
//   ?limit=N      max listings to create this run (default 45, max 300).
//   ?prices=0     skip pushing eBay price changes to listings already on Hip
//                 (on by default, 15 per run).
//   ?samples=N    include N example rows per bucket.
//
// Same CRON_SECRET / signed-in-admin auth as the other crons.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runHipPublish } from "@/lib/hip/publish";

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
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  const num = (k: string) => (q.get(k) != null && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  try {
    const result = await runHipPublish({
      dryRun: q.get("dry") === "1" ? true : undefined,
      limit: num("limit"),
      prices: q.get("prices") !== "0", // on by default (Vercel Cron calls the bare path)
      samples: num("samples"),
    });
    console.log(`[hip-publish] ${JSON.stringify({ ...result, samples: undefined })}`);
    const status = result.failed > 0 || result.priceUpdates.failed > 0 ? 207 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Hip publish failed" },
      { status: 500 }
    );
  }
}
