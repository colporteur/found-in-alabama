// GET /api/admin/ebay/oauth/start
// Builds the eBay authorize URL with a signed `state` and redirects the
// browser to it. After consent, eBay redirects to /api/admin/ebay/oauth/callback.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildAuthorizeUrl, signState } from "@/lib/ebay/oauth";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/signin", process.env.AUTH_URL ?? "http://localhost:3000"));
  }

  try {
    const state = signState();
    const url = buildAuthorizeUrl(state);
    return NextResponse.redirect(url);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
