// GET /api/admin/guides/results — Todd's own results per Expert Guide (Phase 5c).
//   ?guide=<id>            one guide in full (omit for the overview of all guides)
//   &from=YYYY-MM-DD&to=   window (default: last 365 days, US Central)
//   &children=1            include the guide's child guides
//   &unsure=1              include links still awaiting review
// Signed-in admin, or "Authorization: Bearer <FIA API key>" (the Expert Guides
// Portal on Todd's PC uses a key).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { bearerFromRequest, verifyApiKey } from "@/lib/api-keys";
import { guideResults, guideResultsOverview } from "@/lib/guides/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function allowed(req: NextRequest): Promise<string | null> {
  const token = bearerFromRequest(req);
  if (token) {
    const key = await verifyApiKey(token);
    return key ? `key:${key.name}` : null;
  }
  const session = await auth();
  return session?.user ? session.user.email ?? "admin" : null;
}

const dateArg = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function GET(req: NextRequest) {
  if (!(await allowed(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const from = dateArg(q.get("from")), to = dateArg(q.get("to"));
  try {
    const guide = q.get("guide");
    if (!guide) return NextResponse.json(await guideResultsOverview({ from, to }));
    return NextResponse.json(
      await guideResults(guide, {
        from, to, includeChildren: q.get("children") === "1", includeUnsure: q.get("unsure") === "1",
        items: Math.min(100, Math.max(0, Number(q.get("items") ?? 25) || 0)),
      })
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
