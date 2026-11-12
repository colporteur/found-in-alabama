// /api/admin/bolo — Discontinued BOLO list.
// POST multipart/form-data { photo: File, hint?: string } → AI identifies the
//      product, checks it's discontinued, finds comps, saves it to bolo_items
// POST application/json { action: "hide", id } → removes a saved item from the list

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { addBoloFromPhoto, hideBoloItem } from "@/lib/bolo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const who = session.user.email ?? "admin";

  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      const photo = form.get("photo");
      if (!(photo instanceof Blob)) throw new Error("Attach a photo.");
      const hint = form.get("hint");
      const item = await addBoloFromPhoto({
        photo: new Uint8Array(await photo.arrayBuffer()),
        hint: typeof hint === "string" ? hint : null,
        who,
      });
      return NextResponse.json({ ok: true, item });
    }

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (b.action === "hide") {
      await hideBoloItem(String(b.id ?? ""));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
