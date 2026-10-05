// POST /api/email/inbound — called ONLY by the "fia-inbox" Cloudflare
// Email Worker (cloudflare/fia-inbox-worker.js) with the raw RFC 822
// message as the body. Auth: `Authorization: Bearer $EMAIL_INBOUND_SECRET`
// (same value set as INBOUND_SECRET on the worker).
//
// Headers from the worker:
//   X-Envelope-To / X-Envelope-From — SMTP envelope
//   X-Raw-Size  — original size in bytes
//   X-Truncated — "1" when the message was over the worker's cap and only
//                 headers were sent (the worker forwards the full message
//                 to its FALLBACK_FORWARD address)
//
// Response: { ok, stored, forwardTo } — the worker forwards when
// forwardTo is set. /api is outside the middleware matcher, so no session.

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { receiveInbound } from "@/lib/email/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const secret = process.env.EMAIL_INBOUND_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const envelopeTo = req.headers.get("x-envelope-to");
  if (!envelopeTo) {
    return NextResponse.json({ ok: false, error: "Missing X-Envelope-To" }, { status: 400 });
  }
  const raw = Buffer.from(await req.arrayBuffer());
  const sizeHeader = Number(req.headers.get("x-raw-size"));
  try {
    const result = await receiveInbound({
      raw,
      envelopeTo,
      envelopeFrom: req.headers.get("x-envelope-from"),
      rawSize: Number.isFinite(sizeHeader) && sizeHeader > 0 ? sizeHeader : null,
      truncated: req.headers.get("x-truncated") === "1",
    });
    console.log(
      `[mail] to=${envelopeTo} stored=${result.stored} forward=${result.forwardTo ?? "-"}`
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[mail] inbound failed", err);
    // Non-2xx → the worker falls back to FALLBACK_FORWARD, so nothing is lost.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Inbound failed" },
      { status: 500 }
    );
  }
}
