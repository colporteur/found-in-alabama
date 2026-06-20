// GET    /api/admin/newsletter/drafts/[id] — full draft for editor
// PATCH  /api/admin/newsletter/drafts/[id] — update editable fields
// DELETE /api/admin/newsletter/drafts/[id] — hard delete

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, newsletterDrafts } from "@/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [row] = await db
    .select()
    .from(newsletterDrafts)
    .where(eq(newsletterDrafts.id, params.id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ draft: row });
}

type PatchBody = {
  label?: string;
  emailSubject?: string;
  ebaySubject?: string;
  emailBody?: string;
  ebayBody?: string;
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  type Patch = Partial<typeof newsletterDrafts.$inferInsert>;
  const patch: Patch = { updatedAt: new Date() };
  if (body.label !== undefined) patch.label = body.label;
  if (body.emailSubject !== undefined) patch.emailSubject = body.emailSubject;
  if (body.ebaySubject !== undefined) patch.ebaySubject = body.ebaySubject;
  if (body.emailBody !== undefined) patch.emailBody = body.emailBody;
  if (body.ebayBody !== undefined) patch.ebayBody = body.ebayBody;

  const [updated] = await db
    .update(newsletterDrafts)
    .set(patch)
    .where(eq(newsletterDrafts.id, params.id))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ draft: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [row] = await db
    .delete(newsletterDrafts)
    .where(eq(newsletterDrafts.id, params.id))
    .returning({ id: newsletterDrafts.id });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
