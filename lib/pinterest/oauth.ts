// Pinterest OAuth (Authorization Code grant) for API v5.
//
// Flow:
//   1. Click "Connect Pinterest" → /api/admin/pinterest/oauth/start
//   2. We build a signed state + redirect to Pinterest's consent page
//   3. User picks an account on pinterest.com and approves the scopes
//   4. Pinterest redirects to PINTEREST_REDIRECT_URI with code + state
//   5. Callback verifies state, exchanges code for tokens, persists them
//
// Subsequent API calls use getValidAccessToken(), which refreshes via
// the stored refresh_token when within 60s of expiry.
//
// Required env vars (see /admin/settings/posting for setup steps):
//   PINTEREST_CLIENT_ID         — from developers.pinterest.com
//   PINTEREST_CLIENT_SECRET     — from developers.pinterest.com
//   PINTEREST_REDIRECT_URI      — https://www.foundinalabama.com/api/admin/pinterest/oauth/callback
//   PINTEREST_OAUTH_STATE_SECRET — random string, ≥32 chars

import { db } from "@/db";
import { pinterestOAuthTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

// Pinterest v5 quirk: creating a pin requires BOTH pins:write AND
// boards:write. The board scope covers "writing to a board" which is
// what create-pin technically does. Without boards:write, every
// createPin call returns 401 with:
//   "Missing: ['boards:write']"
// If you change this list, existing OAuth tokens do NOT automatically
// pick up the new scopes — you have to reconnect at /admin/settings/posting.
export const REQUIRED_SCOPES = [
  "boards:read",
  "boards:write",
  "pins:read",
  "pins:write",
  "user_accounts:read",
];

const SINGLETON_ID = "singleton";
const AUTHORIZE_URL = "https://www.pinterest.com/oauth/";
const TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. See /admin/settings/posting for Pinterest setup.`
    );
  }
  return v;
}

/** Random + HMAC signature so the callback can verify the state. */
export function signState(): string {
  const secret = requireEnv("PINTEREST_OAUTH_STATE_SECRET");
  const random = crypto.randomBytes(16).toString("hex");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(random)
    .digest("hex")
    .slice(0, 32);
  return `${random}.${sig}`;
}

export function verifyState(state: string): boolean {
  const secret = process.env.PINTEREST_OAUTH_STATE_SECRET;
  if (!secret) return false;
  const parts = state.split(".");
  if (parts.length !== 2) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(parts[0])
    .digest("hex")
    .slice(0, 32);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(parts[1])
    );
  } catch {
    return false;
  }
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("PINTEREST_CLIENT_ID"),
    redirect_uri: requireEnv("PINTEREST_REDIRECT_URI"),
    response_type: "code",
    scope: REQUIRED_SCOPES.join(","),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  refresh_token_expires_in?: number; // seconds (Pinterest defaults ~365 days)
  scope: string;
  token_type: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  // Pinterest accepts client credentials either as Basic auth or in the
  // body. We use Basic auth — same pattern as eBay.
  const auth = Buffer.from(
    `${requireEnv("PINTEREST_CLIENT_ID")}:${requireEnv("PINTEREST_CLIENT_SECRET")}`
  ).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Pinterest token exchange failed (HTTP ${res.status}): ${text.slice(0, 800)}`
    );
  }
  return JSON.parse(text) as TokenResponse;
}

/** Exchange the authorization code from the callback for tokens, persist them. */
export async function exchangeCodeForTokens(code: string): Promise<void> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: requireEnv("PINTEREST_REDIRECT_URI"),
  });
  const tokens = await postToken(body);

  const now = Date.now();
  await db
    .insert(pinterestOAuthTokens)
    .values({
      id: SINGLETON_ID,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
      refreshTokenExpiresAt: new Date(
        now + (tokens.refresh_token_expires_in ?? 365 * 24 * 60 * 60) * 1000
      ),
      scope: tokens.scope || REQUIRED_SCOPES.join(","),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pinterestOAuthTokens.id,
      set: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
        refreshTokenExpiresAt: new Date(
          now + (tokens.refresh_token_expires_in ?? 365 * 24 * 60 * 60) * 1000
        ),
        scope: tokens.scope || REQUIRED_SCOPES.join(","),
        updatedAt: new Date(),
      },
    });
}

/** Refresh-if-needed, then return a usable access token. */
export async function getValidAccessToken(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(pinterestOAuthTokens)
    .where(eq(pinterestOAuthTokens.id, SINGLETON_ID))
    .limit(1);
  if (!row) return null;

  const now = Date.now();
  if (row.accessTokenExpiresAt.getTime() - now > 60_000) {
    return row.accessToken;
  }
  if (!row.refreshToken) return null;
  if (row.refreshTokenExpiresAt.getTime() - now < 0) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: row.refreshToken,
    scope: REQUIRED_SCOPES.join(","),
  });
  const tokens = await postToken(body);

  await db
    .update(pinterestOAuthTokens)
    .set({
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
      // Pinterest sometimes rotates the refresh token; persist it if changed.
      refreshToken: tokens.refresh_token ?? row.refreshToken,
      updatedAt: new Date(),
    })
    .where(eq(pinterestOAuthTokens.id, SINGLETON_ID));

  return tokens.access_token;
}

export async function getOAuthStatus(): Promise<{
  connected: boolean;
  scope?: string;
  pinterestUsername?: string | null;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
}> {
  const [row] = await db
    .select()
    .from(pinterestOAuthTokens)
    .where(eq(pinterestOAuthTokens.id, SINGLETON_ID))
    .limit(1);
  if (!row) return { connected: false };
  return {
    connected: true,
    scope: row.scope,
    pinterestUsername: row.pinterestUsername,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt,
  };
}

export async function disconnectOAuth(): Promise<void> {
  await db
    .delete(pinterestOAuthTokens)
    .where(eq(pinterestOAuthTokens.id, SINGLETON_ID));
}

/** Returns null when env vars are missing so the settings page can warn. */
export function isConfigured(): boolean {
  return (
    !!process.env.PINTEREST_CLIENT_ID &&
    !!process.env.PINTEREST_CLIENT_SECRET &&
    !!process.env.PINTEREST_REDIRECT_URI &&
    !!process.env.PINTEREST_OAUTH_STATE_SECRET
  );
}
