// /api/admin/ebay/sales/tiers
// GET  — current tier config + quarterly age distribution (for the chart).
// POST — save tier config. Body: { tiers: SaleTier[] }

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getAgeDistribution,
  getTiers,
  saveTiers,
  type SaleTier,
} from "@/lib/ebay/sale-tiers";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [tiers, distribution] = await Promise.all([
      getTiers(),
      getAgeDistribution(),
    ]);
    return NextResponse.json({ tiers, distribution });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { tiers?: SaleTier[] };
  try {
    body = (await req.json()) as { tiers?: SaleTier[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.tiers)) {
    return NextResponse.json({ error: "tiers[] required" }, { status: 400 });
  }
  try {
    const saved = await saveTiers(body.tiers);
    return NextResponse.json({ tiers: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 400 }
    );
  }
}
