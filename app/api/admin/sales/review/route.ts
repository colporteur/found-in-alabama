// POST /api/admin/sales/review — settle a sale the matcher couldn't.
// Body: { id, action: "match", ref }   ref = registry id, eBay item id/URL,
//                                       or the venue's own listing id
//       { id, action: "ignore" | "reopen" }
// A matched sale is planned on the next sales-sync run.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveSaleManually, setSaleIgnored } from "@/lib/sales/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const who = session.user.email ?? "admin";

  let body: { id?: string; action?: string; ref?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  if (body.action === "match") {
    if (!body.ref?.trim()) return NextResponse.json({ error: "ref is required" }, { status: 400 });
    const r = await resolveSaleManually(body.id, body.ref, who);
    return NextResponse.json(r, { status: r.ok ? 200 : 404 });
  }
  if (body.action === "ignore" || body.action === "reopen") {
    const ok = await setSaleIgnored(body.id, body.action === "ignore", who);
    return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
  }
  return NextResponse.json({ error: "action must be match, ignore or reopen" }, { status: 400 });
}
