// GET/POST /api/admin/email/addresses — list / create assigned addresses.
// Admin-session gated. Creating pushes a Cloudflare Email Routing rule and,
// for forwarding, registers the forward-to address as a Cloudflare
// destination (which emails it a verification link the first time).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { configuredDomains, createAddress, listAddresses } from "@/lib/email/addresses";
import { validateAddressInput } from "@/lib/email/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, addresses: await listAddresses() });
}

export async function POST(req: NextRequest) {
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
  const v = validateAddressInput(body, configuredDomains());
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  const result = await createAddress(v.value);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, address: result.row, destination: result.destination });
}
