// POST /api/admin/listings/intake — start a listing draft (Phase LIST-1).
// Called by "Send to listing" on the PC (Bearer API key) and by the manual
// lister (signed-in session). Creates the registry item + draft + photo rows
// and returns where to upload each photo. Re-sending the same source item
// returns the existing draft (idempotent). See lib/listings/intake.ts.

import { NextRequest, NextResponse } from "next/server";
import { listingCaller } from "@/lib/listings/auth";
import { parseIntakeRequest } from "@/lib/listings/validate";
import { startIntake } from "@/lib/listings/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const who = await listingCaller(req);
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseIntakeRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await startIntake(parsed.value, who);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
