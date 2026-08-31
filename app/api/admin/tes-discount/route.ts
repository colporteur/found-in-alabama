// GET/POST /api/admin/tes-discount — read/save the TES store-wide flat
// discount percentage ("always X% below eBay"). Admin-session gated.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getTesDiscountPercent,
  setTesDiscountPercent,
} from "@/lib/tes/discount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, percent: await getTesDiscountPercent() });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let body: { percent?: unknown };
  try {
    body = (await req.json()) as { percent?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const n = Number(body.percent);
  if (!Number.isFinite(n)) {
    return NextResponse.json(
      { ok: false, error: "percent must be a number" },
      { status: 400 }
    );
  }
  await setTesDiscountPercent(n);
  return NextResponse.json({ ok: true, percent: await getTesDiscountPercent() });
}
