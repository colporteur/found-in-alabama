// POST /api/admin/email/addresses/[id]/resync — re-push one address's
// rule to Cloudflare (the Retry button after a failed sync).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { resyncAddress } from "@/lib/email/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await resyncAddress(params.id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, address: result.row });
}
