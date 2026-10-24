// POST /api/admin/listings/:id/ebay
//   { action: "check" }   eBay's dry run (creates nothing)
//   { action: "publish" } a real listing, after a clean check
//   { action: "auto" }    check, then publish only if eBay accepts it (the
//                         Listings page's batch button)
//   { action: "route", route: "ebay" | "nifty" | null }   this draft's road
//   { action: "card", card: {graded:false,condition} | {graded:true,grader,grade,cert} }
// Admin session only — never an API key or the Claude connector.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { checkAndPublish, checkDraftOnEbay, publishDraftToEbay, setDraftCardCondition, setDraftRoute } from "@/lib/ebay/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to the admin" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const who = session.user.email ?? "admin";
  const b = (await req.json().catch(() => ({}))) as { action?: string; route?: unknown; card?: unknown };
  try {
    if (b.action === "check") return NextResponse.json({ ok: true, check: await checkDraftOnEbay(params.id, who) });
    if (b.action === "publish") return NextResponse.json({ ok: true, ...(await publishDraftToEbay(params.id, who)) });
    if (b.action === "auto") return NextResponse.json(await checkAndPublish(params.id, who));
    if (b.action === "route") {
      const route = b.route === "ebay" || b.route === "nifty" ? b.route : null;
      await setDraftRoute(params.id, route);
      return NextResponse.json({ ok: true, route });
    }
    if (b.action === "card") return NextResponse.json({ ok: true, card: await setDraftCardCondition(params.id, b.card) });
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[ebay-publish]", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
