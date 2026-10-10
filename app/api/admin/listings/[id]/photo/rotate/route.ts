// POST /api/admin/listings/:id/photo/rotate { position, delta: 90 | -90 | 180 }
// Turn one draft photo; a rotated copy replaces it everywhere downstream.
// Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { rotatePhoto } from "@/lib/listings/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { position?: unknown; delta?: unknown };
  const delta = Number(b.delta);
  const position = Number(b.position);
  if (!/^[0-9a-f-]{36}$/i.test(params.id) || !Number.isInteger(position) || ![90, -90, 180].includes(delta)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await rotatePhoto(params.id, position, delta as 90 | -90 | 180)) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
