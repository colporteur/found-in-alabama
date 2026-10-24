// POST /api/admin/shipping/envelope { itemIds?: string[] }
// SHIP-2: start a "shipping_policy" batch that moves Standard Envelope
// candidates (lib/shipping/envelope-audit.ts) onto the envelope policy.
// Only ids that are still candidates are queued; the enhance queue runs it
// (every 5 minutes) and each item can be rolled back from the batch page.
// Admin session only.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createBatch } from "@/lib/enhance/queue";
import { envelopeCandidates } from "@/lib/shipping/envelope-audit";
import { ENVELOPE_POLICY_ID } from "@/lib/ebay/shipping-policy";
import { MAIL_MAX_PRICE } from "@/lib/shipping/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to the admin" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { itemIds?: unknown };
  const wanted = Array.isArray(b.itemIds) ? new Set(b.itemIds.map(String)) : null;
  const list = (await envelopeCandidates()).filter((c) => !wanted || wanted.has(c.itemId));
  if (!list.length) return NextResponse.json({ ok: false, error: "No candidates to switch" }, { status: 400 });
  const batch = await createBatch({
    op: "shipping_policy",
    label: `Standard Envelope: ${list.length} listing${list.length === 1 ? "" : "s"}`,
    config: { policyId: ENVELOPE_POLICY_ID, envelope: true, maxPrice: MAIL_MAX_PRICE },
    items: list.map((c) => ({ ebayItemId: c.itemId, title: c.title })),
  });
  return NextResponse.json({ ok: true, batchId: batch.id, queued: list.length });
}
