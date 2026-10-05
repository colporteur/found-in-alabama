// POST /api/fia/checkout — Stripe Checkout Session for a foundinalabama.com
// cart (Phase FIA-SHOP-1). Same shape as /api/tes/checkout: the browser
// sends only { lines: [{ itemId, quantity }] }; prices, discount and the
// weight-based shipping are rebuilt server-side (lib/fia/orders), and
// availability is double-checked LIVE against eBay before any money is
// taken. The order goes into the shared tes_orders table with
// source = "fia", so the existing Stripe webhook, delist queue, Nifty
// extension, orders board and Pirate Ship export all pick it up.

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tesOrders, tesOrderItems } from "@/db/schema";
import { resolveFiaCart, type FiaCheckoutLine } from "@/lib/fia/orders";
import { liveCheckAvailability } from "@/lib/tes/live-check";
import { isTesHostName } from "@/lib/tes/host";
import { serviceLabel } from "@/lib/fia/shipping";

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

  const host = req.headers.get("host") ?? "www.foundinalabama.com";
  if (isTesHostName(host)) {
    // The TES site has its own checkout; never mix carts across sites.
    return NextResponse.json({ error: "Wrong checkout." }, { status: 400 });
  }

  let body: { lines?: FiaCheckoutLine[] };
  try {
    body = (await req.json()) as { lines?: FiaCheckoutLine[] };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const resolution = await resolveFiaCart(body.lines ?? []);
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

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const stripe = new Stripe(secretKey);

  // Pending order first, so the webhook has a row to flip even if the
  // buyer closes the tab mid-payment.
  const [order] = await db
    .insert(tesOrders)
    .values({
      source: "fia",
      status: "pending",
      subtotal: quote.subtotal.toFixed(2),
      shipping: quote.shipping.toFixed(2),
      total: (quote.subtotal + quote.shipping).toFixed(2),
      // FIA orders are priced by weight, not class; record the service
      // here so the orders board and the email say what was charged for.
      governingShipClass: quote.service,
      freeShipping: quote.free,
      packageWeightOz: quote.weightOz.toFixed(2),
      shipService: quote.service,
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
      weightOz: l.weightOz.toFixed(2),
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
          display_name: quote.free
            ? "Free shipping"
            : serviceLabel(quote.service),
          type: "fixed_amount",
          fixed_amount: {
            amount: Math.round(quote.shipping * 100),
            currency: "usd",
          },
        },
      },
    ],
    // tesOrderId is the key the shared webhook reads (name kept for
    // compatibility); site tells the two storefronts' orders apart.
    metadata: { tesOrderId: order.id, site: "fia" },
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/cart`,
  });

  await db
    .update(tesOrders)
    .set({ stripeSessionId: session.id })
    .where(eq(tesOrders.id, order.id));

  return NextResponse.json({ url: session.url });
}
