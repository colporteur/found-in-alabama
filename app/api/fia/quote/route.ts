// POST /api/fia/quote — price a foundinalabama.com cart (Phase FIA-SHOP-1).
// Body { lines: [{ itemId, quantity }] }. Returns the server-side line
// prices and the weight-based shipping quote the checkout will charge, so
// the cart page never computes money itself. No eBay live check here —
// that happens once, at checkout.

import { NextRequest, NextResponse } from "next/server";
import { resolveFiaCart, type FiaCheckoutLine } from "@/lib/fia/orders";
import { serviceLabel } from "@/lib/fia/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { lines?: FiaCheckoutLine[] };
  try {
    body = (await req.json()) as { lines?: FiaCheckoutLine[] };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const r = await resolveFiaCart(body.lines ?? []);
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: r.error, unavailable: r.unavailable },
      { status: 409 }
    );
  }
  return NextResponse.json({
    ok: true,
    lines: r.lines.map((l) => ({
      itemId: l.itemId,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
    })),
    quote: {
      subtotal: r.quote.subtotal,
      shipping: r.quote.shipping,
      free: r.quote.free,
      service: r.quote.service,
      serviceLabel: serviceLabel(r.quote.service),
      weightOz: r.quote.weightOz,
      freeAt: r.quote.freeAt,
      remainingForFree: r.quote.remainingForFree,
    },
  });
}
