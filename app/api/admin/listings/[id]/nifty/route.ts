// POST /api/admin/listings/:id/nifty  { niftyId?, warnings?, error? }
// The extension reports the Nifty draft it created for an approved draft
// (→ status in_nifty) or why it couldn't. API key or session.

import { NextRequest, NextResponse } from "next/server";
import { listingCaller } from "@/lib/listings/auth";
import { recordNiftyResult } from "@/lib/listings/nifty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const who = await listingCaller(req);
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { niftyId?: unknown; warnings?: unknown; error?: unknown };
  const r = await recordNiftyResult(params.id, {
    niftyId: typeof b.niftyId === "string" ? b.niftyId : null,
    warnings: Array.isArray(b.warnings) ? b.warnings.map(String) : [],
    error: typeof b.error === "string" ? b.error : null,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
