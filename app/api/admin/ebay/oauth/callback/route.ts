// GET /api/admin/ebay/oauth/callback?code=...&state=...
// Final leg of the OAuth dance. Verifies state, exchanges code for tokens,
// stores them, and bounces the browser back to /admin/ebay/sales.
//
// IMPORTANT: this URL must match what was registered in the eBay developer
// portal under the RuName. EBAY_OAUTH_REDIRECT_URI in .env.local must be
// the same value.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeCodeForTokens, verifyState } from "@/lib/ebay/oauth";

export const runtime = "nodejs";
export const maxDuration = 30;

function homeUrl(req: NextRequest, query: Record<string, string>): URL {
  const base = process.env.AUTH_URL ?? new URL(req.url).origin;
  const url = new URL("/admin/ebay/sales/connect", base);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/signin", process.env.AUTH_URL ?? "http://localhost:3000"));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(homeUrl(req, { oauth_error: error }));
  }
  if (!code || !state) {
    return NextResponse.redirect(
      homeUrl(req, { oauth_error: "missing_code_or_state" })
    );
  }
  if (!verifyState(state)) {
    return NextResponse.redirect(homeUrl(req, { oauth_error: "bad_state" }));
  }

  try {
    await exchangeCodeForTokens(code);
    return NextResponse.redirect(homeUrl(req, { oauth: "ok" }));
  } catch (err) {
    return NextResponse.redirect(
      homeUrl(req, { oauth_error: (err as Error).message.slice(0, 200) })
    );
  }
}
