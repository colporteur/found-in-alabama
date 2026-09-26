// Daily automatic sale maintenance. Live eBay state is reconciled before writes.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { maintainSales } from "@/lib/ebay/sale-maintenance";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!(secret && req.headers.get("authorization") === `Bearer ${secret}`) && !(await auth())?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await maintainSales({ announce: req.nextUrl.searchParams.get('announce') !== 'false' });
    return NextResponse.json(summary, { status: summary.errors.length ? 503 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Maintenance failed" }, { status: 500 });
  }
}
