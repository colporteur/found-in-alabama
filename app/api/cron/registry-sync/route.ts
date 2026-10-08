// GET /api/cron/registry-sync — rebuild/refresh the item registry from the
// Nifty capture, the eBay mirror and the Hip map (Phase REG-1). Idempotent;
// writes only the registry tables. Hourly from vercel.json, and on demand
// from the "Run sync now" button on /admin/registry.
// Same CRON_SECRET / signed-in-admin auth as the other crons.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runRegistrySync } from "@/lib/registry/sync";

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
  const result = await runRegistrySync();
  console.log(
    `[registry-sync] ok=${result.ok} ms=${result.ms}` +
      (result.error ? ` error=${result.error}` : "")
  );
  return NextResponse.json(result, {
    status: result.ok ? 200 : 500,
    headers: { "Cache-Control": "private, no-store" },
  });
}
