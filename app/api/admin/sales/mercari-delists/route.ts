// /api/admin/sales/mercari-delists — the extension's "Delist on Mercari" (pilot).
// GET  → { legs }: open Mercari delist legs FIA planned.
// POST { legId, result, detail } after the extension acted in Todd's Mercari
//      tab → recorded on the leg. API key (extension) or admin session.

import { NextRequest, NextResponse } from "next/server";
import { listingCaller } from "@/lib/listings/auth";
import { mercariDelistQueue, recordMercariDelist } from "@/lib/sales/mercari-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await listingCaller(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, legs: await mercariDelistQueue() });
}

export async function POST(req: NextRequest) {
  const who = await listingCaller(req);
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return NextResponse.json(await recordMercariDelist({ legId: String(b.legId ?? ""), result: String(b.result ?? ""), detail: (b.detail as string) ?? null, who }));
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
