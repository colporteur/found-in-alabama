// POST /api/admin/api-keys
// Auth: signed-in admin (via NextAuth session)
// Body: { name: string }
// Returns: { plaintext, row: { id, name, prefix, createdAt, ... } }
//
// Plaintext is shown ONCE here and never again. Hash + prefix are stored.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { generateApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { plaintext, hash, prefix } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ name, keyHash: hash, prefix })
    .returning();

  return NextResponse.json({
    plaintext,
    row: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
      lastUsedAt: null,
      revokedAt: null,
    },
  });
}
