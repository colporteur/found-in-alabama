// Ask the business (Phase 5b): OAuth storage for the FIA connector.
// Codes and tokens are random, shown to the client once, and stored only
// as SHA-256 hashes in mcp_tokens. One approval = one grant (grant_id);
// revoking a grant on /admin/connect kills all of its tokens.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
  ACCESS_TTL_S,
  CODE_TTL_S,
  REFRESH_TTL_S,
  pkceOk,
  randomToken,
  redirectAllowed,
  sha256hex,
} from "./oauth-core";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export async function mcpReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.mcp_tokens') IS NOT NULL AS ok`);
  return !!r?.ok;
}

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

// ─── clients (Dynamic Client Registration) ───────────────────────────────────

export async function registerClient(body: Record<string, unknown>) {
  const uris = (Array.isArray(body.redirect_uris) ? body.redirect_uris : []).map(String);
  if (!uris.length) throw new OAuthError("invalid_redirect_uri", "redirect_uris is required");
  const bad = uris.find((u) => !redirectAllowed(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `Redirect not allowed: ${bad}`);
  const name = String(body.client_name ?? "").slice(0, 120) || null;
  const id = randomToken("fiac_");
  await db.execute(sql`INSERT INTO mcp_clients (id, name, redirect_uris) VALUES (${id}, ${name}, ${JSON.stringify(uris)}::jsonb)`);
  return {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name ?? undefined,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export async function loadClient(id: string): Promise<{ id: string; name: string | null; redirectUris: string[] } | null> {
  const [r] = await rows(sql`SELECT id, name, redirect_uris FROM mcp_clients WHERE id = ${id}`);
  if (!r) return null;
  return { id: String(r.id), name: (r.name as string | null) ?? null, redirectUris: (r.redirect_uris as string[]) ?? [] };
}

// ─── codes and tokens ────────────────────────────────────────────────────────

async function insertToken(p: {
  clientId: string;
  kind: "code" | "access" | "refresh";
  grantId: string;
  ttlS: number;
  codeChallenge?: string | null;
  redirectUri?: string | null;
  who?: string | null;
}): Promise<string> {
  const prefix = p.kind === "code" ? "fiacode_" : p.kind === "access" ? "fiaat_" : "fiart_";
  const token = randomToken(prefix);
  await db.execute(sql`
    INSERT INTO mcp_tokens (client_id, kind, token_hash, grant_id, code_challenge, redirect_uri, expires_at, created_by)
    VALUES (${p.clientId}, ${p.kind}, ${sha256hex(token)}, ${p.grantId}::uuid, ${p.codeChallenge ?? null},
            ${p.redirectUri ?? null}, now() + make_interval(secs => ${p.ttlS}), ${p.who ?? null})`);
  return token;
}

/** Todd clicked Allow: a one-time code for the client's callback. */
export async function createAuthCode(p: { clientId: string; redirectUri: string; codeChallenge: string; who: string }): Promise<string> {
  const client = await loadClient(p.clientId);
  if (!client) throw new OAuthError("invalid_client", "Unknown client — remove the connector in Claude and add it again.");
  if (!client.redirectUris.includes(p.redirectUri) || !redirectAllowed(p.redirectUri))
    throw new OAuthError("invalid_request", "That redirect address isn't registered for this client.");
  const [g] = await rows(sql`SELECT gen_random_uuid() AS id`);
  return insertToken({
    clientId: p.clientId,
    kind: "code",
    grantId: String(g.id),
    ttlS: CODE_TTL_S,
    codeChallenge: p.codeChallenge,
    redirectUri: p.redirectUri,
    who: p.who,
  });
}

async function issuePair(clientId: string, grantId: string) {
  const access = await insertToken({ clientId, kind: "access", grantId, ttlS: ACCESS_TTL_S });
  const refresh = await insertToken({ clientId, kind: "refresh", grantId, ttlS: REFRESH_TTL_S });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: "read" };
}

/** Marks a token used (once) and returns its row, or null. */
async function claim(token: string, kind: string): Promise<Row | null> {
  const [r] = await rows(sql`
    UPDATE mcp_tokens SET used_at = now()
    WHERE token_hash = ${sha256hex(token)} AND kind = ${kind} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
    RETURNING id, client_id, grant_id, code_challenge, redirect_uri`);
  return r ?? null;
}

export async function exchangeCode(p: { code: string; clientId: string; redirectUri: string; verifier: string }) {
  const r = await claim(p.code, "code");
  if (!r) {
    // A replayed code may mean it leaked: kill whatever it already produced.
    await db.execute(sql`
      UPDATE mcp_tokens SET revoked_at = now()
      WHERE revoked_at IS NULL AND grant_id IN (SELECT grant_id FROM mcp_tokens WHERE token_hash = ${sha256hex(p.code)} AND kind = 'code')`);
    throw new OAuthError("invalid_grant", "The code is invalid, used or expired.");
  }
  if (String(r.client_id) !== p.clientId) throw new OAuthError("invalid_grant", "The code belongs to another client.");
  if (String(r.redirect_uri) !== p.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match.");
  if (!pkceOk(p.verifier, String(r.code_challenge ?? ""))) throw new OAuthError("invalid_grant", "PKCE check failed.");
  return issuePair(p.clientId, String(r.grant_id));
}

export async function refreshTokens(p: { refreshToken: string; clientId: string | null }) {
  const r = await claim(p.refreshToken, "refresh");
  if (!r) throw new OAuthError("invalid_grant", "The refresh token is invalid, used or expired.");
  if (p.clientId && String(r.client_id) !== p.clientId) throw new OAuthError("invalid_grant", "Wrong client.");
  // Rotation: the old access token of this grant stops working too.
  await db.execute(sql`UPDATE mcp_tokens SET revoked_at = now() WHERE grant_id = ${String(r.grant_id)}::uuid AND kind = 'access' AND revoked_at IS NULL`);
  return issuePair(String(r.client_id), String(r.grant_id));
}

export async function revokeToken(token: string): Promise<void> {
  await db.execute(sql`
    UPDATE mcp_tokens SET revoked_at = now()
    WHERE revoked_at IS NULL AND grant_id IN (SELECT grant_id FROM mcp_tokens WHERE token_hash = ${sha256hex(token)})`);
}

/** The bearer check for /api/mcp. */
export async function verifyAccessToken(token: string): Promise<{ clientId: string; grantId: string } | null> {
  if (!token.startsWith("fiaat_")) return null;
  const [r] = await rows(sql`
    UPDATE mcp_tokens SET last_used_at = now()
    WHERE token_hash = ${sha256hex(token)} AND kind = 'access' AND revoked_at IS NULL AND expires_at > now()
    RETURNING client_id, grant_id`);
  return r ? { clientId: String(r.client_id), grantId: String(r.grant_id) } : null;
}

// ─── /admin/connect ──────────────────────────────────────────────────────────

export type Connection = {
  grantId: string;
  clientName: string | null;
  approvedBy: string | null;
  approvedAt: string;
  lastUsedAt: string | null;
  active: boolean;
};

export async function listConnections(): Promise<Connection[]> {
  const list = await rows(sql`
    SELECT t.grant_id, c.name,
           max(t.created_by) AS approved_by,
           min(t.created_at) AS approved_at,
           max(t.last_used_at) AS last_used_at,
           bool_or(t.kind = 'refresh' AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now()) AS active
    FROM mcp_tokens t LEFT JOIN mcp_clients c ON c.id = t.client_id
    GROUP BY t.grant_id, c.name
    HAVING bool_or(t.kind <> 'code')
    ORDER BY min(t.created_at) DESC
    LIMIT 50`);
  const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  return list.map((r) => ({
    grantId: String(r.grant_id),
    clientName: (r.name as string | null) ?? null,
    approvedBy: (r.approved_by as string | null) ?? null,
    approvedAt: iso(r.approved_at) ?? "",
    lastUsedAt: iso(r.last_used_at),
    active: !!r.active,
  }));
}

export async function revokeGrant(grantId: string): Promise<void> {
  await db.execute(sql`UPDATE mcp_tokens SET revoked_at = now() WHERE grant_id = ${grantId}::uuid AND revoked_at IS NULL`);
}
