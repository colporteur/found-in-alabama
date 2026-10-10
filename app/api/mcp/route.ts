// /api/mcp — "Ask the business" (Phase 5b): FIA's read-only MCP server for
// the Claude app's custom connector. Streamable HTTP, stateless, JSON
// replies. Every call needs an access token from the connector's sign-in
// (approved by Todd on /admin/connect/authorize).

import { handleRpc } from "@/lib/mcp/protocol";
import { TOOLS } from "@/lib/mcp/tools";
import { verifyAccessToken } from "@/lib/mcp/oauth";
import { siteOrigin } from "@/lib/mcp/oauth-core";
import { CORS, json, preflight } from "@/lib/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized(req: Request, why: string) {
  const meta = `${siteOrigin(req)}/.well-known/oauth-protected-resource`;
  return json({ error: "invalid_token", error_description: why }, 401, {
    "WWW-Authenticate": `Bearer error="invalid_token", error_description="${why}", resource_metadata="${meta}"`,
  });
}

export async function POST(req: Request) {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return unauthorized(req, "Sign in required");
  const who = await verifyAccessToken(m[1].trim()).catch(() => null);
  if (!who) return unauthorized(req, "Token expired or revoked");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const reply = await handleRpc(body, TOOLS);
  if (reply === null) return new Response(null, { status: 202, headers: CORS });
  return json(reply);
}

// No server-initiated stream and no sessions in this stateless server.
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { ...CORS, Allow: "POST" } });
}
export const DELETE = GET;
export const OPTIONS = preflight;
