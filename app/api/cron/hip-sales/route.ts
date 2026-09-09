// GET /api/cron/hip-sales — Phase HIP-1 poller. Pulls paid HipPostcard
// sales since the cursor and works each one (see lib/hip/ingest.ts):
// Hip wins → eBay ended by API + Nifty delist queued; already sold
// elsewhere → CANCEL HIP flagged for Todd. Meant to run every 15 minutes
// from GitHub Actions (hip-sales-cron.yml), same CRON_SECRET as the
// other crons. No-ops (configured:false) until HIP_API_KEY/HIP_USERNAME
// are set in Vercel.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { ingestHipSales } from "@/lib/hip/ingest";

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
    const result = await ingestHipSales();
    console.log(`[hip-sales] ${JSON.stringify(result)}`);
    return NextResponse.json(result, { status: result.errors.length ? 207 : 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Hip sales poll failed" },
      { status: 500 }
    );
  }
}
