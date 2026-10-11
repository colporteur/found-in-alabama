// POST /api/admin/listings/:id/ebay  { action: "check" | "publish" }
// Phase 3e pilot: eBay's dry run, then (after a clean check) a real listing.
// Admin session only — never an API key or the Claude connector.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { checkDraftOnEbay, publishDraftToEbay } from "@/lib/ebay/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to the admin" }, { status: 401 });
  const who = session.user.email ?? "admin";
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    if (b.action === "check") return NextResponse.json({ ok: true, check: await checkDraftOnEbay(params.id, who) });
    if (b.action === "publish") return NextResponse.json({ ok: true, ...(await publishDraftToEbay(params.id, who)) });
    return NextResponse.json({ error: "action must be check or publish" }, { status: 400 });
  } catch (err) {
    console.error("[ebay-publish]", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
