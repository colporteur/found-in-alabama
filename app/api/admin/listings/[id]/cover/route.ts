// POST /api/admin/listings/:id/cover { positions: number[] }
// Build a cover collage from those photos (in that order) and make it photo 1;
// a cover FIA made earlier is replaced. Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { makeDraftCover } from "@/lib/listings/lots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { positions?: unknown };
  const positions = Array.isArray(b.positions) ? b.positions.map(Number) : [];
  try {
    return NextResponse.json({ ok: true, ...(await makeDraftCover(params.id, positions)) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
