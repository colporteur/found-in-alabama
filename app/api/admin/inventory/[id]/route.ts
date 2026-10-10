// POST /api/admin/inventory/:id — edit FIA's record of an item.
// { action: "save", title?, binSku?, status?, soldOnVenue?, notes? }
// { action: "unlock", field: "title" | "bin_sku" | "status" } — hand the
//   field back to the Nifty sync.
// Admin session only. Changes FIA's record; nothing goes to any venue.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { unlockField, updateItem } from "@/lib/inventory/browse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const who = session.user.email ?? "admin";
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (b.action === "unlock") {
      await unlockField(params.id, String(b.field ?? ""), who);
      return NextResponse.json({ ok: true });
    }
    const pick = (k: string) => (k in b ? (b[k] == null ? null : String(b[k])) : undefined);
    const r = await updateItem(
      params.id,
      {
        title: pick("title") ?? undefined,
        binSku: pick("binSku"),
        status: pick("status") as never,
        soldOnVenue: pick("soldOnVenue"),
        notes: pick("notes"),
      },
      who
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
