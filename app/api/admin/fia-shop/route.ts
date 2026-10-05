// GET/POST /api/admin/fia-shop — foundinalabama.com direct-sale settings
// (Phase FIA-SHOP-1): the "X% below eBay" discount and the shipping
// settings (rate tables, handling, free threshold, caps, fallback
// weights). Admin-session gated. Saving purges the storefront cache so
// prices and "eBay-only" states update at once.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getFiaDiscountPercent,
  getFiaShipSettings,
  setFiaDiscountPercent,
  setFiaShipSettings,
} from "@/lib/fia/settings";
import { revalidateStorefront } from "@/lib/storefront-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const [percent, settings] = await Promise.all([
    getFiaDiscountPercent(),
    getFiaShipSettings(),
  ]);
  return NextResponse.json({ ok: true, percent, settings });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let body: { percent?: unknown; settings?: unknown };
  try {
    body = (await req.json()) as { percent?: unknown; settings?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (body.percent !== undefined) {
    const n = Number(body.percent);
    if (!Number.isFinite(n)) {
      return NextResponse.json(
        { ok: false, error: "percent must be a number" },
        { status: 400 }
      );
    }
    await setFiaDiscountPercent(n);
  }
  if (body.settings !== undefined) {
    await setFiaShipSettings(body.settings);
  }
  revalidateStorefront("fia-shop settings changed");
  const [percent, settings] = await Promise.all([
    getFiaDiscountPercent(),
    getFiaShipSettings(),
  ]);
  return NextResponse.json({ ok: true, percent, settings });
}
