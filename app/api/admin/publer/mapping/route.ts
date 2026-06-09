// POST /api/admin/publer/mapping
// Body: { accountId: string, channel: string | null }
// Sets which ChannelKey one Publer account is responsible for, clearing
// any other account previously mapped to the same channel.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { setMapping } from "@/lib/publer/api";
import { CHANNELS, type ChannelKey } from "@/lib/social/channel-styles";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { accountId?: string; channel?: string | null };
  try {
    body = (await req.json()) as { accountId?: string; channel?: string | null };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }
  if (body.channel !== null && body.channel !== undefined) {
    if (!Object.keys(CHANNELS).includes(body.channel)) {
      return NextResponse.json(
        { error: `Unknown channel "${body.channel}"` },
        { status: 400 }
      );
    }
  }
  await setMapping(body.accountId, (body.channel ?? null) as ChannelKey | null);
  return NextResponse.json({ ok: true });
}
