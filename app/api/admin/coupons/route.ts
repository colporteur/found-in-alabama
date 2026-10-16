// POST /api/admin/coupons — save the invoice coupon settings (COUPON-1).
// Body: { enabled, percent, days, venues: { ebay: true, ... } }
// A new percent or lifetime applies to codes made from now on; codes already
// printed keep what they were issued with.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveCouponSettings } from "@/lib/shop/coupons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, settings: await saveCouponSettings(body) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
