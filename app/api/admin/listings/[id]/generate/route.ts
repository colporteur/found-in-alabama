// POST /api/admin/listings/:id/generate  { tier?: "auto"|"simple"|"general"|"premium", corrections?: string }
// Runs the listing writer on one draft (Phase LIST-2) and leaves it in
// "review". Signed-in admin or an API key. Writes only the draft and its
// AI run records — nothing is published.

import { NextRequest, NextResponse } from "next/server";
import { listingCaller } from "@/lib/listings/auth";
import { generateDraft } from "@/lib/listings/writer";
import { isTier } from "@/lib/listings/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const who = await listingCaller(req);
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { tier?: unknown; corrections?: unknown };
  const tier = isTier(b.tier) ? b.tier : "auto";
  const corrections = typeof b.corrections === "string" ? b.corrections.slice(0, 2000) : null;
  const r = await generateDraft(params.id, { tier, corrections, who });
  return NextResponse.json(r, { status: r.ok ? 200 : r.status });
}
