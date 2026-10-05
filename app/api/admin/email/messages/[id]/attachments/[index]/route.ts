// GET /api/admin/email/messages/[id]/attachments/[index] — one attachment,
// re-extracted from the stored raw message. Always served as a download
// (never inline) so an HTML/SVG attachment can't run on the admin origin.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { emailMessages } from "@/db/schema";
import { extractAttachment } from "@/lib/email/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; index: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const index = Number(params.index);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ ok: false, error: "Bad index" }, { status: 400 });
  }
  const [row] = await db
    .select({ raw: emailMessages.rawBase64 })
    .from(emailMessages)
    .where(eq(emailMessages.id, params.id))
    .limit(1);
  if (!row?.raw) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const att = await extractAttachment(row.raw, index);
  if (!att) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const safeName = att.filename.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "attachment";
  return new NextResponse(Buffer.from(att.content), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
