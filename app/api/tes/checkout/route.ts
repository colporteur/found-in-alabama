// POST /api/tes/checkout — create a Stripe Checkout Session for the TES
// cart. The browser sends only { lines: [{ itemId, quantity }] }; price,
// sale discounts, ship class, and shipping fees are all recomputed
// server-side from the mirror (lib/tes/orders), and availability is
// double-checked LIVE against eBay (lib/tes/live-check) before any
// money is taken. A pending tes_orders row is written first; the
// webhook flips it to paid.

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tesOrders, tesOrderItems } from "@/db/schema";
import { resolveCart, type CheckoutRequestLine } from "@/lib/tes/orders";
import { liveCheckAvailability } from "@/lib/tes/live-check";
import { isTesHostName } from "@/lib/tes/host";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json(
      { error: "Checkout is not configured yet." },
      { status: 503 }
    );
  }

  let body: { lines?: CheckoutRequestLine[] };
  try {
    body = (await req.json()) as { lines?: CheckoutRequestLine[] };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const resolution = await resolveCart(body.lines ?? []);
  if (!resolution.ok) {
    return NextResponse.json(
      { error: resolution.error, unavailable: resolution.unavailable },
      { status: 409 }
    );
  }
  const { lines, quote } = resolution;

  // Buy-time live check against eBay (the mirror can be ~15 min stale).
  const live = await liveCheckAvailability(
    lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity }))
  );
  if (live.unavailable.length > 0) {
    return NextResponse.json(
      {
        error:
          live.unavailable.length === 1
            ? "One item in your cart just sold elsewhere and has been removed."
            : `${live.unavailable.length} items in your cart just sold elsewhere and have been removed.`,
        unavailable: live.unavailable,
      },
      { status: 409 }
    );
  }

  // Where to send the buyer back to. On theephemeralstate.com the /tes
  // prefix is hidden by the middleware rewrite; on the preview path it
  // must be explicit.
  const host = req.headers.get("host") ?? "theephemeralstate.com";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const prefix = isTesHostName(host) ? "" : "/tes";
  const origin = `${proto}://${host}`;

  const stripe = new Stripe(secretKey);

  // Record the order first (status pending) so the webhook has a row to
  // flip even if the user closes the tab mid-payment.
  const [order] = await db
    .insert(tesOrders)
    .values({
      status: "pending",
      subtotal: quote.subtotal.toFixed(2),
      shipping: quote.shipping.toFixed(2),
      total: (quote.subtotal + quote.shipping).toFixed(2),
      governingShipClass: quote.governingClass,
      freeShipping: quote.free,
    })
    .returning({ id: tesOrders.id });

  await db.insert(tesOrderItems).values(
    lines.map((l) => ({
      orderId: order.id,
      itemId: l.itemId,
      title: l.title,
      sku: l.sku,
      unitPrice: l.unitPrice.toFixed(2),
      quantity: l.quantity,
      shipClass: l.shipClass,
      imageUrl: l.imageUrl,
    }))
  );

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: order.id,
    line_items: lines.map((l) => ({
      quantity: l.quantity,
      price_data: {
        currency: "usd",
        unit_amount: Math.round(l.unitPrice * 100),
        product_data: {
          name: l.title.slice(0, 120),
          ...(l.imageUrl ? { images: [l.imageUrl] } : {}),
          metadata: { ebayItemId: l.itemId },
        },
      },
    })),
    shipping_address_collection: { allowed_countries: ["US"] },
    shipping_options: [
      {
        shipping_rate_data: {
          display_name: quote.free ? "Free shipping" : "Shipping & handling",
          type: "fixed_amount",
          fixed_amount: {
            amount: Math.round(quote.shipping * 100),
            currency: "usd",
          },
        },
      },
    ],
    metadata: { tesOrderId: order.id },
    success_url: `${origin}${prefix}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${prefix}/cart`,
  });

  await db
    .update(tesOrders)
    .set({ stripeSessionId: session.id })
    .where(eq(tesOrders.id, order.id));

  return NextResponse.json({ url: session.url });
}
