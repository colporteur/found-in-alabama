// GET /api/admin/email/messages/[id]/raw — download the original message
// as .eml (opens in Outlook / Thunderbird / Apple Mail).

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { emailMessages } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const [row] = await db
    .select({ raw: emailMessages.rawBase64 })
    .from(emailMessages)
    .where(eq(emailMessages.id, params.id))
    .limit(1);
  if (!row?.raw) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(row.raw, "base64"), {
    headers: {
      "Content-Type": "message/rfc822",
      "Content-Disposition": `attachment; filename="message-${params.id.slice(0, 8)}.eml"`,
    },
  });
}
