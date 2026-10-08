// POST /api/admin/listings/:id/complete — confirm a draft's photo uploads
// (checks storage). All present → status uploading → ready.

import { NextRequest, NextResponse } from "next/server";
import { listingCaller } from "@/lib/listings/auth";
import { completeIntake } from "@/lib/listings/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const who = await listingCaller(req);
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const result = await completeIntake(params.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
