// POST /api/admin/registry/review — dismiss or reopen a registry review row.
// Body: { id: string, action: "dismiss" | "reopen" }
// Dismissed rows survive the hourly sync (only open rows are rebuilt).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { registryReview } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.id || (body.action !== "dismiss" && body.action !== "reopen")) {
    return NextResponse.json({ error: "id and action (dismiss|reopen) are required" }, { status: 400 });
  }

  const dismiss = body.action === "dismiss";
  const [row] = await db
    .update(registryReview)
    .set({
      status: dismiss ? "dismissed" : "open",
      resolvedBy: dismiss ? session.user.email ?? "admin" : null,
      resolvedAt: dismiss ? new Date() : null,
    })
    .where(eq(registryReview.id, body.id))
    .returning({ id: registryReview.id, status: registryReview.status });

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
