// PATCH /api/admin/email/messages/[id] — { read?: boolean, archived?: boolean }.
// No delete: mail is kept as an archive.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { emailMessages } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let body: { read?: unknown; archived?: unknown };
  try {
    body = (await req.json()) as { read?: unknown; archived?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const set: { readAt?: Date | null; archivedAt?: Date | null } = {};
  if (typeof body.read === "boolean") set.readAt = body.read ? new Date() : null;
  if (typeof body.archived === "boolean") set.archivedAt = body.archived ? new Date() : null;
  if (!Object.keys(set).length) {
    return NextResponse.json({ ok: false, error: "Nothing to change" }, { status: 400 });
  }
  const [row] = await db
    .update(emailMessages)
    .set(set)
    .where(eq(emailMessages.id, params.id))
    .returning({ id: emailMessages.id });
  if (!row) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
