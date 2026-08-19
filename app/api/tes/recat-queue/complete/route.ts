// POST /api/tes/recat-queue/complete — the extension reports the outcome
// of one recategorize entry. Auth: Bearer <api key>.
//
// Body: { id, status: "done" | "manual" | "failed", note? }
//   done   — Nifty's Store categories field now shows the new set; the
//            local eBay mirror is updated immediately so the storefront
//            reflects the fix before the next full sync confirms it.
//   manual — the actuator couldn't do it safely (ambiguous title match,
//            popover not found, ...); stays visible in the popup log.
//   failed — an attempt errored; row keeps its state for a retry after
//            the underlying problem is fixed (failed rows are NOT
//            re-served automatically — flag the item again if needed).

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings, tesRecatQueue } from "@/db/schema";
import { bearerFromRequest, verifyApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { id?: string; status?: string; note?: string };

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
  if (!body.id || !["done", "manual", "failed"].includes(body.status ?? "")) {
    return NextResponse.json(
      { ok: false, error: "id and status (done|manual|failed) required" },
      { status: 400 }
    );
  }

  const [row] = await db
    .select()
    .from(tesRecatQueue)
    .where(eq(tesRecatQueue.id, body.id))
    .limit(1);
  if (!row) {
    return NextResponse.json({ ok: false, error: "Entry not found" }, { status: 404 });
  }

  await db
    .update(tesRecatQueue)
    .set({
      status: body.status,
      note: body.note?.slice(0, 500) ?? null,
      completedAt: new Date(),
    })
    .where(eq(tesRecatQueue.id, body.id));

  if (body.status === "done") {
    // Mirror the change locally so the storefront + admin reflect it now.
    await db
      .update(ebayListings)
      .set({
        storeCategory1Id: row.newCategory1Id ?? row.oldCategory1Id,
        storeCategory2Id: row.newCategory2Id ?? row.oldCategory2Id,
      })
      .where(eq(ebayListings.itemId, row.itemId));
  }

  console.log(
    `[tes recat-queue] ${key.name} reported ${row.itemId}: ${body.status}${
      body.note ? ` — ${body.note}` : ""
    }`
  );

  return NextResponse.json({ ok: true });
}
