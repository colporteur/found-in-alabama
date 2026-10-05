import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadHipReadiness } from "@/lib/hip/readiness-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const report = await loadHipReadiness(req.nextUrl.searchParams.get("compare") === "1");
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the inventory report. Please try again." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
