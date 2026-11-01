// POST /api/admin/listings/:id/photos { photos: [{ name, sha256, bytes, contentType }] }
// "Add photos" on the draft page: register more photos on an existing draft
// (after its last one) and return where to upload each (through the app,
// POST /photo?position=N), then the page calls /complete. Used for drafts
// Claude created from a chat, which arrive with no photos. Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { addDraftPhotos, type AddPhoto } from "@/lib/listings/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { photos?: unknown };
  const photos = Array.isArray(b.photos)
    ? (b.photos as Record<string, unknown>[]).map((p) => ({
        name: String(p?.name ?? "photo.jpg"),
        sha256: String(p?.sha256 ?? ""),
        bytes: Number(p?.bytes ?? 0),
        contentType: String(p?.contentType ?? ""),
      })) as AddPhoto[]
    : [];
  if (!photos.length) return NextResponse.json({ error: "No photos" }, { status: 400 });
  const out = await addDraftPhotos(params.id, photos);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true, uploads: out.uploads });
}
