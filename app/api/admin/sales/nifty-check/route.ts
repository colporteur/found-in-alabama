// /api/admin/sales/nifty-check — the extension's "Check sales & delists".
// GET  → { since, lastCheck, openLegs }: how far back to read Nifty's sales.
// POST { since, items, pages, complete } after the sold items went through
//      /api/admin/items/capture → records the check and scores delist
//      outcomes right away. API key (extension) or admin session.

import { NextRequest, NextResponse } from "next/server";
import { listingCaller } from "@/lib/listings/auth";
import { niftyCheckWindow, recordNiftyCheck } from "@/lib/sales/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await listingCaller(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await niftyCheckWindow()) });
}

export async function POST(req: NextRequest) {
  if (!(await listingCaller(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await recordNiftyCheck({ since: String(b.since ?? ""), items: Number(b.items ?? 0), complete: b.complete === true });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("[nifty-check] failed", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
