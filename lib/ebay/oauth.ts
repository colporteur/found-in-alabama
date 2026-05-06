// eBay OAuth (Authorization Code grant) for the Sell APIs.
//
// Why a second auth chain in this app: the older Trading API (used in
// Phase eBay-1) accepts an Auth'n'Auth user token in the request body.
// The newer Sell APIs (Marketing, Account, Analytics) require an OAuth
// access token in an Authorization: Bearer header. Different chain.
//
// Flow we implement:
//   1. /admin/ebay/sales/connect calls /api/admin/ebay/oauth/start
//   2. We build a state-signed authorize URL and 302 the browser to it
//   3. User signs in on eBay and consents to the requested scopes
//   4. eBay redirects to EBAY_OAUTH_REDIRECT_URI with code + state
//   5. /api/admin/ebay/oauth/callback verifies state, exchanges code
//      for tokens, and persists them to ebay_oauth_tokens (single row).
//
// Subsequent Sell API calls use getValidAccessToken(), which returns a
// non-expired access_token, refreshing it via the stored refresh_token
// when needed.

import { db } from "@/db";
import { ebayOAuthTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

/** Scopes we ask for. Add more here when we need additional Sell APIs. */
export const REQUIRED_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
];

const SINGLETON_ID = "singleton";

function isSandbox(): boolean {
  return (process.env.EBAY_ENV ?? "production") === "sandbox";
}

/** eBay's consent host (where the user signs in). */
function authorizeHost(): string {
  return isSandbox()
    ? "https://auth.sandbox.ebay.com"
    : "https://auth.ebay.com";
}

/** eBay's token-exchange endpoint. */
function tokenUrl(): string {
  return isSandbox()
    ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
    : "https://api.ebay.com/identity/v1/oauth2/token";
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. See PHASE-EBAY-2-SETUP.md for OAuth setup.`
    );
  }
  return v;
}

/**
 * Sign the OAuth `state` parameter so the callback can verify the request
 * actually came from a flow we initiated. Format: "<random>.<sig>".
 */
export function signState(): string {
  const secret = requireEnv("EBAY_OAUTH_STATE_SECRET");
  const random = crypto.randomBytes(16).toString("hex");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(random)
    .digest("hex")
    .slice(0, 32);
  return `${random}.${sig}`;
}

export function verifyState(state: string): boolean {
  const secret = process.env.EBAY_OAUTH_STATE_SECRET;
  if (!secret) return false;
  const parts = state.split(".");
  if (parts.length !== 2) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(parts[0])
    .digest("hex")
    .slice(0, 32);
  // Constant-time compare.
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
    client_id: requireEnv("EBAY_APP_ID"),
    response_type: "code",
    // Note: eBay requires the RuName here, NOT the actual https URL.
    redirect_uri: requireEnv("EBAY_RU_NAME"),
    scope: REQUIRED_SCOPES.join(" "),
    state,
    prompt: "login",
  });
  return `${authorizeHost()}/oauth2/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds
  refresh_token?: string;
  refresh_token_expires_in?: number; // seconds
  token_type: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const auth = Buffer.from(
    `${requireEnv("EBAY_APP_ID")}:${requireEnv("EBAY_CERT_ID")}`
  ).toString("base64");
  const res = await fetch(tokenUrl(), {
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
      `eBay token exchange failed (HTTP ${res.status}): ${text.slice(0, 800)}`
    );
  }
  return JSON.parse(text) as TokenResponse;
}

/** Exchange an authorization code (from the OAuth callback) for tokens
 *  and persist them. */
export async function exchangeCodeForTokens(code: string): Promise<void> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: requireEnv("EBAY_RU_NAME"),
  });
  const tokens = await postToken(body);

  const now = Date.now();
  await db
    .insert(ebayOAuthTokens)
    .values({
      id: SINGLETON_ID,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
      refreshTokenExpiresAt: new Date(
        now + (tokens.refresh_token_expires_in ?? 47304000) * 1000
      ),
      scope: REQUIRED_SCOPES.join(" "),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: ebayOAuthTokens.id,
      set: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? "",
        accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
        refreshTokenExpiresAt: new Date(
          now + (tokens.refresh_token_expires_in ?? 47304000) * 1000
        ),
        scope: REQUIRED_SCOPES.join(" "),
        updatedAt: new Date(),
      },
    });
}

/** Call this before every Sell API request. Refreshes the access token if
 *  it's within 60 seconds of expiry. Returns null if no tokens are stored
 *  (caller should redirect to the connect-OAuth UI). */
export async function getValidAccessToken(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(ebayOAuthTokens)
    .where(eq(ebayOAuthTokens.id, SINGLETON_ID))
    .limit(1);
  if (!row) return null;

  const now = Date.now();
  // Refresh if access token expires in the next 60s.
  if (row.accessTokenExpiresAt.getTime() - now > 60_000) {
    return row.accessToken;
  }

  if (!row.refreshToken) return null;
  if (row.refreshTokenExpiresAt.getTime() - now < 0) {
    // Refresh token itself is expired — user needs to re-consent.
    return null;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: row.refreshToken,
    scope: REQUIRED_SCOPES.join(" "),
  });
  const tokens = await postToken(body);

  await db
    .update(ebayOAuthTokens)
    .set({
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(ebayOAuthTokens.id, SINGLETON_ID));

  return tokens.access_token;
}

export async function getOAuthStatus(): Promise<{
  connected: boolean;
  scope?: string;
  ebayUsername?: string | null;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
}> {
  const [row] = await db
    .select()
    .from(ebayOAuthTokens)
    .where(eq(ebayOAuthTokens.id, SINGLETON_ID))
    .limit(1);
  if (!row) return { connected: false };
  return {
    connected: true,
    scope: row.scope,
    ebayUsername: row.ebayUsername,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt,
  };
}

export async function disconnectOAuth(): Promise<void> {
  await db.delete(ebayOAuthTokens).where(eq(ebayOAuthTokens.id, SINGLETON_ID));
}
