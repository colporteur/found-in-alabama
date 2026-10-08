// PATCH /api/admin/listings/:id — edit a draft's listing content by hand.
// POST  /api/admin/listings/:id  { action: "discard" | "restore" }
// Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseSpecifics, setDraftStatus, updateDraft, type DraftEdit } from "@/lib/listings/drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const edit: DraftEdit = {};
  if ("title" in b) edit.title = text(b.title, 80); // eBay title limit
  if ("description" in b) edit.description = text(b.description, 20000);
  if ("condition" in b) edit.condition = text(b.condition, 60);
  if ("conditionNote" in b) edit.conditionNote = text(b.conditionNote, 1000);
  if ("ebayCategoryId" in b) edit.ebayCategoryId = text(b.ebayCategoryId, 20);
  if ("ebayCategoryName" in b) edit.ebayCategoryName = text(b.ebayCategoryName, 300);
  if ("itemSpecifics" in b) {
    const spec = typeof b.itemSpecifics === "string" ? parseSpecifics(b.itemSpecifics) : null;
    edit.itemSpecifics = spec && Object.keys(spec).length ? spec : null;
  }
  if ("price" in b) edit.price = num(b.price);
  if ("binSku" in b) edit.binSku = text(b.binSku, 120);
  if ("weightOz" in b) edit.weightOz = num(b.weightOz);
  if ("quantity" in b) edit.quantity = Math.max(1, Math.round(num(b.quantity) ?? 1));
  if ("notes" in b) edit.notes = text(b.notes, 4000);

  const r = await updateDraft(params.id, edit);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  if (b.action !== "discard" && b.action !== "restore") {
    return NextResponse.json({ error: "action must be discard or restore" }, { status: 400 });
  }
  const r = await setDraftStatus(params.id, b.action, session.user.email ?? "admin");
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
