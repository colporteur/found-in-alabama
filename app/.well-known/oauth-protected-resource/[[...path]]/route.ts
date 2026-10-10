// RFC 9728 metadata for the FIA connector (Phase 5b). Also answers the
// path-suffixed form (/.well-known/oauth-protected-resource/api/mcp).
import { protectedResourceMetadata, siteOrigin } from "@/lib/mcp/oauth-core";
import { json, preflight } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return json(protectedResourceMetadata(siteOrigin(req)));
}
export const OPTIONS = preflight;
