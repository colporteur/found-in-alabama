// POST /api/admin/listings/:id/research
//   { question?: string }                    → run research (top-tier model + web search + guides)
//   { action: "picks", use: number[], titleOk: boolean } → which findings the next write uses
// Writes only the draft's ai_meta.research and AI run records — nothing is published.

import { NextRequest, NextResponse } from "next/server";
import { listingCaller } from "@/lib/listings/auth";
import { researchDraft, setResearchPicks } from "@/lib/listings/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const who = await listingCaller(req);
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; question?: unknown; use?: unknown; titleOk?: unknown };
  if (b.action === "picks") {
    const use = Array.isArray(b.use) ? b.use.map(Number).filter((n) => Number.isInteger(n) && n >= 0) : [];
    const ok = await setResearchPicks(params.id, use, b.titleOk === true);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  }
  const question = typeof b.question === "string" ? b.question : null;
  const r = await researchDraft(params.id, { question, who });
  return NextResponse.json(r, { status: r.ok ? 200 : r.status });
}
