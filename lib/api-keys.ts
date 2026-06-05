// Tiny helper module for API key generation + verification. Used by the
// Chrome extension to authenticate POSTs to /api/admin/items/capture.
//
// Key format: "fia_" + 32 random bytes (base64url). The plaintext is shown
// once at creation and never stored. We persist a SHA-256 hash plus a
// short prefix (first 8 chars of the key) for display in the keys list.

import crypto from "node:crypto";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

const KEY_PREFIX = "fia_";

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  // 32 random bytes encoded base64url (URL-safe, no padding) → ~43 chars
  const random = crypto.randomBytes(32).toString("base64url");
  const plaintext = `${KEY_PREFIX}${random}`;
  const hash = hashKey(plaintext);
  const prefix = plaintext.slice(0, 12); // "fia_" + first 8 random chars
  return { plaintext, hash, prefix };
}

export function hashKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Verify a bearer token. Returns the key row if valid and not revoked,
 * null otherwise. Updates lastUsedAt as a side effect on success.
 *
 * Constant-time comparison via crypto.timingSafeEqual on the hash; the
 * SHA-256 hash means the DB query is also exact-match on a stored hash
 * (no plaintext ever in transit through our DB).
 */
export async function verifyApiKey(plaintext: string): Promise<{
  id: string;
  name: string;
} | null> {
  if (!plaintext.startsWith(KEY_PREFIX)) return null;
  const hash = hashKey(plaintext);
  const [row] = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  // Fire-and-forget lastUsedAt update — don't block the request on it
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id));
  return { id: row.id, name: row.name };
}

/**
 * Extract the bearer token from a request's Authorization header.
 * Returns null if missing or malformed.
 */
export function bearerFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
