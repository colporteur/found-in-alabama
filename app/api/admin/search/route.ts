// POST /api/admin/search — site search admin (SEARCH-1).
// { action: "synonyms", text }   save the synonym list
// { action: "rebuild" }          refresh the index now (and embed what fits)
// Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { embedPending, refreshSearchIndex, saveSynonyms } from "@/lib/search/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; text?: string };
  try {
    if (b.action === "synonyms") {
      const groups = await saveSynonyms(String(b.text ?? ""));
      return NextResponse.json({ ok: true, groups: groups.length });
    }
    if (b.action === "rebuild") {
      const refreshed = await refreshSearchIndex();
      const embedded = await embedPending(200_000);
      return NextResponse.json({ ok: true, refreshed, embedded });
    }
    return NextResponse.json({ error: 'action must be "synonyms" or "rebuild"' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
