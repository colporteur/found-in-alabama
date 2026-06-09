// GET /api/admin/pinterest/oauth/callback
//
// Pinterest redirects here after the user approves the consent. We:
//   1. Verify the state matches our HttpOnly cookie + signature
//   2. Exchange the code for access + refresh tokens
//   3. Persist them (pinterestOAuthTokens, singleton row)
//   4. Pull the username + boards while we're at it
//   5. Redirect back to /admin/settings/posting

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  exchangeCodeForTokens,
  verifyState,
} from "@/lib/pinterest/oauth";
import { db, pinterestOAuthTokens } from "@/db";
import { eq } from "drizzle-orm";
import { getUserAccount, syncBoardsToCache } from "@/lib/pinterest/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const SETTINGS_PATH = "/admin/settings/posting";

function redirectWithMessage(
  baseUrl: string,
  kind: "ok" | "error",
  msg: string
) {
  const url = new URL(SETTINGS_PATH, baseUrl);
  url.searchParams.set("pinterest", kind);
  url.searchParams.set("msg", msg);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) {
    return redirectWithMessage(req.url, "error", `Pinterest: ${errParam}`);
  }
  if (!code || !state) {
    return redirectWithMessage(req.url, "error", "Missing code or state in callback.");
  }

  // Verify state against the cookie + signature
  const cookieState = req.cookies.get("pinterest_oauth_state")?.value;
  if (!cookieState || cookieState !== state) {
    return redirectWithMessage(req.url, "error", "State mismatch — possible CSRF, aborting.");
  }
  if (!verifyState(state)) {
    return redirectWithMessage(req.url, "error", "State signature invalid.");
  }

  try {
    await exchangeCodeForTokens(code);
  } catch (err) {
    return redirectWithMessage(
      req.url,
      "error",
      err instanceof Error ? err.message : "Token exchange failed"
    );
  }

  // Best-effort: stash username + boards. Failures here don't block the
  // connection — user can manually click "Sync boards" on settings.
  try {
    const account = await getUserAccount();
    if (account.username) {
      await db
        .update(pinterestOAuthTokens)
        .set({
          pinterestUsername: account.username,
          updatedAt: new Date(),
        })
        .where(eq(pinterestOAuthTokens.id, "singleton"));
    }
  } catch (err) {
    console.warn("[pinterest oauth callback] fetch username failed", err);
  }
  try {
    await syncBoardsToCache();
  } catch (err) {
    console.warn("[pinterest oauth callback] sync boards failed", err);
  }

  // Clear the state cookie + redirect to settings with a success flash
  const ok = redirectWithMessage(req.url, "ok", "Connected.");
  ok.cookies.set("pinterest_oauth_state", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return ok;
}
