// /api/admin/items/listed-sweep — the extension's "Full inventory check".
// GET  → { last }: the most recent run.
// POST { startedAt, seen, total, complete } after every Listed item went
//      through /api/admin/items/capture → records the run and, for a run
//      that covered Nifty's whole Listed view, marks listings Nifty no
//      longer shows as ended. API key (extension) or admin session.

import { NextRequest, NextResponse } from "next/server";
import { listingCaller } from "@/lib/listings/auth";
import { finishListedSweep, lastListedSweeps } from "@/lib/registry/listed-sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await listingCaller(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [last] = await lastListedSweeps();
  return NextResponse.json({ ok: true, last: last ?? null });
}

export async function POST(req: NextRequest) {
  if (!(await listingCaller(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const sweep = await finishListedSweep({
      startedAt: String(b.startedAt ?? ""),
      seen: Number(b.seen ?? 0),
      total: b.total == null ? null : Number(b.total),
      complete: b.complete === true,
    });
    return NextResponse.json({ ok: true, sweep });
  } catch (err) {
    console.error("[listed-sweep] failed", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
