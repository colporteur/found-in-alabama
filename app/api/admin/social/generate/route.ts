// POST /api/admin/social/generate
//
// Body: { sourceType: "haul" | "item", sourceId: string,
//         channels: ChannelKey[], contentType: SocialContentType }
//
// Returns: { drafts: { [channelKey]: <channel-shaped object> }, usage }
//
// Thin wrapper around lib/social/generate.ts (shared with the Phase B
// automation cron): auth + validation here, generation there.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { CHANNELS, type ChannelKey } from "@/lib/social/channel-styles";
import { generateChannelDrafts } from "@/lib/social/generate";
import type { SocialContentType } from "@/lib/social/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

type GenerateRequest = {
  sourceType: "haul" | "item";
  sourceId: string; // slug for haul, uuid for item
  channels: ChannelKey[];
  contentType: SocialContentType;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validChannelKeys = new Set(Object.keys(CHANNELS) as ChannelKey[]);
  const requested = Array.isArray(body.channels)
    ? body.channels.filter((c): c is ChannelKey => validChannelKeys.has(c))
    : [];
  if (requested.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one channel." },
      { status: 400 }
    );
  }

  const validContentTypes = new Set<SocialContentType>([
    "just-listed",
    "new-haul",
    "throwback",
    "just-sold",
  ]);
  if (!validContentTypes.has(body.contentType)) {
    return NextResponse.json(
      { error: `Unknown contentType "${body.contentType}".` },
      { status: 400 }
    );
  }

  if (!body.sourceId) {
    return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
  }
  if (body.sourceType !== "haul" && body.sourceType !== "item") {
    return NextResponse.json(
      { error: `Unknown sourceType "${body.sourceType}".` },
      { status: 400 }
    );
  }

  try {
    const result = await generateChannelDrafts({
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      channels: requested,
      contentType: body.contentType,
    });

    return NextResponse.json({
      drafts: result.drafts,
      missingChannels: result.missingChannels,
      usedVision: result.usedVision,
      generationId: result.generationId,
      contentType: body.contentType,
      source: result.source,
      usage: result.usage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    console.error("[/api/admin/social/generate] failed", err);
    const status = msg.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
