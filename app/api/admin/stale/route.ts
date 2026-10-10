// POST /api/admin/stale — shake-up report actions (Phase 5a).
// { action: "run", kind: "rewrite"|"describe"|"markdown"|"skip", itemIds, guideId?, fillSpecifics? }
//     → Expert Enhance batches (live eBay ReviseItem, rollback kept) + a stale_actions record
// { action: "lot", itemIds } → a lot listing draft in Listings (nothing ends on eBay)
// { action: "settings", settings }

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { makeLotDraft, runShakeUp, saveStaleSettings } from "@/lib/stale/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const who = session.user.email ?? "admin";
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = Array.isArray(b.itemIds) ? b.itemIds.map(String) : [];
  try {
    if (b.action === "settings") return NextResponse.json({ ok: true, settings: await saveStaleSettings(b.settings) });
    if (b.action === "lot") return NextResponse.json({ ok: true, draftId: await makeLotDraft(ids, who) });
    if (b.action === "run") {
      const kind = String(b.kind);
      if (!["rewrite", "describe", "markdown", "skip"].includes(kind)) throw new Error("Unknown shake-up kind");
      if (!ids.length) throw new Error("Pick some items first.");
      const r = await runShakeUp({
        kind: kind as "rewrite" | "describe" | "markdown" | "skip",
        itemIds: ids,
        guideId: (b.guideId as string) || null,
        fillSpecifics: b.fillSpecifics === true,
        who,
      });
      return NextResponse.json({ ok: true, ...r });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
