// PATCH /api/admin/listings/:id — edit a draft's listing content by hand.
// POST  /api/admin/listings/:id  { action: "discard" | "restore" | "approve" | "unapprove" | "send_back", note? }
// Signed-in admin only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseSpecifics, setDraftStatus, updateDraft, type DraftEdit } from "@/lib/listings/drafts";
import { approveDrafts, sendBackDraft, unapproveDraft } from "@/lib/listings/review";

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
  if ("shippingProfile" in b) {
    const p = text(b.shippingProfile, 20);
    edit.shippingProfile = p && ["envelope", "calculated", "media"].includes(p) ? p : null;
  }
  if ("poshmarkPrice" in b) edit.poshmarkPrice = num(b.poshmarkPrice);
  if ("storeCategoryIds" in b) {
    const ids = (Array.isArray(b.storeCategoryIds) ? b.storeCategoryIds : [])
      .map((v) => String(v ?? "").replace(/\D/g, ""))
      .filter(Boolean);
    edit.storeCategoryIds = Array.from(new Set(ids)).slice(0, 2);
  }

  const r = await updateDraft(params.id, edit);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; note?: unknown };
  const who = session.user.email ?? "admin";
  let r: { ok: boolean; error?: string };
  switch (b.action) {
    case "discard":
    case "restore":
      r = await setDraftStatus(params.id, b.action, who);
      break;
    case "approve": {
      const out = await approveDrafts([params.id], who);
      r = out.approved.length ? { ok: true } : { ok: false, error: out.skipped[0]?.reason ?? "Not approved" };
      break;
    }
    case "unapprove":
      r = await unapproveDraft(params.id);
      break;
    case "send_back":
      r = await sendBackDraft(params.id, typeof b.note === "string" ? b.note : null);
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
