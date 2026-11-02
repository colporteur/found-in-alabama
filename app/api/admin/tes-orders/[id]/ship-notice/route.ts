// POST /api/admin/tes-orders/:id/ship-notice { action: "stamped" | "send" | "resend" }
//   stamped  mark the order mailed by stamp (no tracking) and email the buyer
//   send     email the buyer now (an order with tracking whose email failed)
//   resend   email again even though one was sent
// From the store the order came from (lib/tes/ship-notice.ts). Admin-session gated.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { markStamped, sendShipNotice } from "@/lib/tes/ship-notice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { action?: unknown };
  const r =
    b.action === "stamped"
      ? await markStamped(params.id)
      : b.action === "send" || b.action === "resend"
        ? await sendShipNotice(params.id, { force: b.action === "resend" })
        : null;
  if (!r) return NextResponse.json({ error: 'action must be "stamped", "send" or "resend"' }, { status: 400 });
  if (r.error) return NextResponse.json({ ok: false, error: r.error, ...r }, { status: 502 });
  return NextResponse.json({ ok: true, ...r });
}
