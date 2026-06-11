// /api/admin/ebay/sales/tiers
// GET  — tier configs (age + bin) + distributions for both charts.
// POST — save configs. Body: { tiers?: SaleTier[], binTiers?: BinTier[] }
//        (either or both).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  countSyncedListings,
  getAgeDistribution,
  getBinDistribution,
  getBinTiers,
  getTiers,
  saveBinTiers,
  saveTiers,
  type BinTier,
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
    const [tiers, binTiers, distribution, binDistribution, syncedListings] =
      await Promise.all([
        getTiers(),
        getBinTiers(),
        getAgeDistribution(),
        getBinDistribution(),
        countSyncedListings(),
      ]);
    return NextResponse.json({
      tiers,
      binTiers,
      distribution,
      binDistribution,
      syncedListings,
    });
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
  let body: { tiers?: SaleTier[]; binTiers?: BinTier[] };
  try {
    body = (await req.json()) as { tiers?: SaleTier[]; binTiers?: BinTier[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.tiers) && !Array.isArray(body.binTiers)) {
    return NextResponse.json(
      { error: "tiers[] or binTiers[] required" },
      { status: 400 }
    );
  }
  try {
    const result: { tiers?: SaleTier[]; binTiers?: BinTier[] } = {};
    if (Array.isArray(body.tiers)) {
      result.tiers = await saveTiers(body.tiers);
    }
    if (Array.isArray(body.binTiers)) {
      result.binTiers = await saveBinTiers(body.binTiers);
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 400 }
    );
  }
}
