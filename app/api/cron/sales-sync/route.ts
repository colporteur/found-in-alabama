// GET /api/cron/sales-sync — sale detection, shadow mode (Phase SALES-1).
// Ingests sale signals (Hip, Stripe, forwarded sale emails; eBay arrives via
// the events-sync hook), matches them to registry items, records which other
// listings should come down, and checks whether they did. Writes only its
// own tables and the registry's sold state — never a marketplace.
// Every 5 minutes from vercel.json, and from "Run now" on /admin/sales.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSalesSync } from "@/lib/sales/pipeline";
import { syncShipQueue } from "@/lib/fulfillment/queue";

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
  const result = await runSalesSync();
  // Fulfillment (Phase 4a): new sales join the to-ship queue. Never fails the cron.
  const ship = await syncShipQueue().catch((err) => ({ error: (err as Error).message }));
  console.log(`[sales-sync] ${JSON.stringify(result)} ship=${JSON.stringify(ship)}`);
  return NextResponse.json(result, {
    status: result.ok ? 200 : 500,
    headers: { "Cache-Control": "private, no-store" },
  });
}
