// GET/POST /api/admin/tes-featured — read/save the TES featured-slot
// configuration. Admin-session gated.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getFeaturedRawSlots,
  setFeaturedRawSlots,
  type RawSlot,
} from "@/lib/tes/featured";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, slots: await getFeaturedRawSlots() });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let body: { slots?: RawSlot[] };
  try {
    body = (await req.json()) as { slots?: RawSlot[] };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.slots)) {
    return NextResponse.json({ ok: false, error: "slots array required" }, { status: 400 });
  }
  await setFeaturedRawSlots(body.slots);
  return NextResponse.json({ ok: true });
}
