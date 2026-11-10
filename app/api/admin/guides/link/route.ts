// POST /api/admin/guides/link — run the free keyword linker (Phase 5c).
// { rescore?: boolean } → files every sold/live item it can under an Expert
// Guide; call again while "remaining" > 0. Same sign-in as the results route.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { bearerFromRequest, verifyApiKey } from "@/lib/api-keys";
import { runLinkerUntilDone } from "@/lib/guides/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const token = bearerFromRequest(req);
  const ok = token ? !!(await verifyApiKey(token)) : !!(await auth())?.user;
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    /* empty body is fine */
  }
  try {
    return NextResponse.json(await runLinkerUntilDone({ rescore: b.rescore === true, budgetMs: 40_000 }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
