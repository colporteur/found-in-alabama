// PATCH/DELETE /api/admin/email/addresses/[id] — change delivery (mode,
// forward-to, label, on/off) or remove an address. Admin-session gated.
// DELETE removes the Cloudflare rule first; messages already received stay
// in the inbox.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { removeAddress, updateAddress } from "@/lib/email/addresses";
import { isAddressMode, isValidEmail, type AddressMode } from "@/lib/email/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const patch: {
    mode?: AddressMode;
    forwardTo?: string | null;
    label?: string | null;
    enabled?: boolean;
  } = {};
  if (body.mode !== undefined) {
    if (!isAddressMode(body.mode)) {
      return NextResponse.json({ ok: false, error: "Invalid delivery mode" }, { status: 400 });
    }
    patch.mode = body.mode;
  }
  if (body.forwardTo !== undefined) {
    if (body.forwardTo === null || body.forwardTo === "") patch.forwardTo = null;
    else if (!isValidEmail(body.forwardTo)) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid forward-to address." },
        { status: 400 }
      );
    } else patch.forwardTo = String(body.forwardTo).trim().toLowerCase();
  }
  if (body.label !== undefined) {
    patch.label =
      typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : null;
  }
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;

  const result = await updateAddress(params.id, patch);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, address: result.row, destination: result.destination });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await removeAddress(params.id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
