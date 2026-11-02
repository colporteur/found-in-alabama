// POST /api/admin/tes-orders/:id/mailpiece/rotate { turn: 90 | -90 | 180 }
// Turn the stamped-mailpiece photo (SHIP-NOTICE): a new rotated copy goes to
// R2 and replaces the order's photo, so the buyer's email shows it upright.
// Admin-session gated.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { putObject, publicUrl, r2Config } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { turn?: unknown };
  const turn = Number(b.turn);
  if (![90, -90, 180].includes(turn)) return NextResponse.json({ error: "turn must be 90, -90 or 180" }, { status: 400 });
  const cfg = r2Config();
  if (!cfg) return NextResponse.json({ error: "Photo storage (R2) is not configured" }, { status: 503 });

  const res = (await db.execute(sql`SELECT mailpiece_photo_url FROM tes_orders WHERE id = ${params.id}::uuid`)) as {
    rows?: Array<{ mailpiece_photo_url: string | null }>;
  };
  const url = res.rows?.[0]?.mailpiece_photo_url;
  if (!url) return NextResponse.json({ error: "This order has no mailpiece photo" }, { status: 404 });
  const got = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!got.ok) return NextResponse.json({ error: `Couldn't read the photo (HTTP ${got.status})` }, { status: 502 });
  // sharp does one rotation per pipeline: apply the EXIF orientation first,
  // then the turn.
  const upright = await sharp(Buffer.from(await got.arrayBuffer()), { failOn: "none" }).rotate().toBuffer();
  const jpg = await sharp(upright).rotate(turn).jpeg({ quality: 88 }).toBuffer();
  const key = `orders/${params.id}/mailpiece-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.jpg`;
  await putObject(cfg, key, new Uint8Array(jpg), "image/jpeg");
  const next = publicUrl(cfg, key);
  await db.execute(sql`UPDATE tes_orders SET mailpiece_photo_url = ${next} WHERE id = ${params.id}::uuid`);
  return NextResponse.json({ ok: true, url: next });
}
