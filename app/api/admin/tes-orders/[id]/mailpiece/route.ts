// POST /api/admin/tes-orders/:id/mailpiece — body: the JPEG (resized in the
// browser) of the stamped mailpiece, ready to mail. Stored in R2 and shown
// in the buyer's "your order has shipped" email (SHIP-NOTICE).
// DELETE removes it from the order. Admin-session gated.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { putObject, publicUrl, r2Config } from "@/lib/storage/r2";
import { shipNoticeReady } from "@/lib/tes/ship-notice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  if (!(await shipNoticeReady())) return NextResponse.json({ error: "Run migration 0053 first" }, { status: 503 });
  const cfg = r2Config();
  if (!cfg) return NextResponse.json({ error: "Photo storage (R2) is not configured" }, { status: 503 });
  const type = req.headers.get("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return NextResponse.json({ error: "Send a JPEG, PNG or WebP photo" }, { status: 400 });
  const body = new Uint8Array(await req.arrayBuffer());
  if (!body.length || body.length > 4_500_000) return NextResponse.json({ error: "Photo is empty or over 4.5 MB" }, { status: 400 });
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const key = `orders/${params.id}/mailpiece-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${ext}`;
  await putObject(cfg, key, body, type);
  const url = publicUrl(cfg, key);
  const res = (await db.execute(sql`
    UPDATE tes_orders SET mailpiece_photo_url = ${url} WHERE id = ${params.id}::uuid AND source IN ('tes', 'fia') RETURNING id`)) as {
    rows?: unknown[];
  };
  if (!res.rows?.length) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ ok: true, url });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  await db.execute(sql`UPDATE tes_orders SET mailpiece_photo_url = NULL WHERE id = ${params.id}::uuid`);
  return NextResponse.json({ ok: true });
}
