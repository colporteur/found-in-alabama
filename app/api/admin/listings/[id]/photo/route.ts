// POST /api/admin/listings/:id/photo?position=N — upload one photo through
// the app (manual lister, "proxy" mode). The browser downsizes photos first,
// so each body stays under Vercel's 4.5 MB limit. The file must match the
// sha256 / type registered at intake.

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { listingCaller } from "@/lib/listings/auth";
import { putObject, r2Config } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const who = await listingCaller(req);
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = r2Config();
  if (!cfg) return NextResponse.json({ error: "Photo storage (R2) is not configured yet" }, { status: 503 });

  const position = Number(req.nextUrl.searchParams.get("position"));
  if (!/^[0-9a-f-]{36}$/i.test(params.id) || !Number.isInteger(position) || position < 1) {
    return NextResponse.json({ error: "Bad id or position" }, { status: 400 });
  }
  const res = (await db.execute(sql`
    SELECT id, storage_key, sha256, content_type, uploaded_at FROM draft_photos
    WHERE draft_id = ${params.id} AND position = ${position}`)) as { rows?: Record<string, unknown>[] };
  const photo = res.rows?.[0];
  if (!photo) return NextResponse.json({ error: "No such photo slot" }, { status: 404 });
  if (photo.uploaded_at) return NextResponse.json({ ok: true, already: true });

  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length === 0) return NextResponse.json({ error: "Empty body" }, { status: 400 });
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  if (sha !== photo.sha256) return NextResponse.json({ error: "File doesn't match what was registered" }, { status: 400 });

  await putObject(cfg, String(photo.storage_key), body, String(photo.content_type));
  await db.execute(sql`UPDATE draft_photos SET uploaded_at = now(), bytes = ${body.length} WHERE id = ${String(photo.id)}`);
  return NextResponse.json({ ok: true });
}
