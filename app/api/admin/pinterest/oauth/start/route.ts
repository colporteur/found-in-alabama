// GET /api/admin/pinterest/oauth/start
//
// Builds a signed state + redirect to Pinterest's consent page. Sets the
// state in an HttpOnly cookie so the callback can cross-check it (an
// attacker can't forge a callback without that cookie).

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  buildAuthorizeUrl,
  isConfigured,
  signState,
} from "@/lib/pinterest/oauth";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  if (!isConfigured()) {
    return NextResponse.json(
      {
        error:
          "Pinterest OAuth env vars missing. Set PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET, PINTEREST_REDIRECT_URI, and PINTEREST_OAUTH_STATE_SECRET in Vercel.",
      },
      { status: 503 }
    );
  }

  const state = signState();
  const url = buildAuthorizeUrl(state);
  const res = NextResponse.redirect(url);
  // Cookie so the callback can verify the state matches the in-flight handshake.
  res.cookies.set("pinterest_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes is plenty
  });
  return res;
}
