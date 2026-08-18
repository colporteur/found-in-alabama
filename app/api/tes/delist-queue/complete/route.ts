// POST /api/tes/delist-queue/complete — the extension reports the
// outcome of working an order. Auth: Bearer <api key>.
//
// Body: { orderId, allDelisted: boolean, results: [{ itemId, status,
// note? }] } where status is "delisted" | "manual" | "failed".
// Only allDelisted:true flips the order's delistStatus to "done";
// anything else leaves it pending so it stays red in /admin/tes-orders
// for manual follow-up. Results are logged for the server console.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tesOrders } from "@/db/schema";
import { bearerFromRequest, verifyApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  orderId?: string;
  allDelisted?: boolean;
  results?: { itemId: string; status: string; note?: string }[];
};

export async function POST(req: NextRequest) {
  const token = bearerFromRequest(req);
  const key = token ? await verifyApiKey(token) : null;
  if (!key) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.orderId) {
    return NextResponse.json({ ok: false, error: "orderId required" }, { status: 400 });
  }

  console.log(
    `[tes delist-queue] ${key.name} reported order ${body.orderId}: allDelisted=${
      body.allDelisted
    } results=${JSON.stringify(body.results ?? [])}`
  );

  if (body.allDelisted === true) {
    const updated = await db
      .update(tesOrders)
      .set({ delistStatus: "done" })
      .where(eq(tesOrders.id, body.orderId))
      .returning({ id: tesOrders.id });
    if (updated.length === 0) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
  }

  return NextResponse.json({ ok: true });
}
