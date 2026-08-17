// POST /api/tes/stripe-webhook — Stripe event receiver for TES checkout.
// Verifies the signature with STRIPE_WEBHOOK_SECRET, and on
// checkout.session.completed: marks the order paid, stores the buyer's
// email + shipping address, decrements mirror quantities (so the item
// disappears from both storefronts immediately), and emails Todd the
// packing/delist summary. checkout.session.expired marks the order
// canceled so pending rows don't accumulate.

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tesOrders, tesOrderItems, ebayListings } from "@/db/schema";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type ShippingShapes = {
  collected_information?: {
    shipping_details?: { name?: string | null; address?: object | null };
  };
  shipping_details?: { name?: string | null; address?: object | null };
};

async function notifyTodd(orderId: string): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY ?? process.env.AUTH_RESEND_KEY;
    const from = process.env.AUTH_EMAIL_FROM;
    const to = process.env.ADMIN_EMAIL;
    if (!apiKey || !from || !to) return;

    const [order] = await db
      .select()
      .from(tesOrders)
      .where(eq(tesOrders.id, orderId))
      .limit(1);
    if (!order) return;
    const items = await db
      .select()
      .from(tesOrderItems)
      .where(eq(tesOrderItems.orderId, orderId));

    const addr = order.shippingAddress as Record<string, string> | null;
    const addressText = addr
      ? [addr.line1, addr.line2, `${addr.city}, ${addr.state} ${addr.postal_code}`]
          .filter(Boolean)
          .join("<br/>")
      : "(no address on file)";

    const rows = items
      .map(
        (i) =>
          `<tr><td style="padding:4px 8px">${i.quantity}×</td><td style="padding:4px 8px">${i.title}</td><td style="padding:4px 8px">${i.sku ?? ""}</td><td style="padding:4px 8px">${i.shipClass}</td><td style="padding:4px 8px">$${i.unitPrice}</td><td style="padding:4px 8px"><a href="https://www.ebay.com/itm/${i.itemId}">${i.itemId}</a></td></tr>`
      )
      .join("");

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `TES order — $${order.total} (${items.length} item${items.length === 1 ? "" : "s"}) — DELIST IN NIFTY`,
        html: `<h2>New Ephemeral State order</h2>
<p><strong>${order.shippingName ?? ""}</strong> &lt;${order.email ?? ""}&gt;<br/>${addressText}</p>
<table border="0" cellspacing="0">${rows}</table>
<p>Subtotal $${order.subtotal} · Shipping $${order.shipping}${order.freeShipping ? " (free)" : ""} · <strong>Total $${order.total}</strong> · ship class: ${order.governingShipClass}</p>
<p><strong>Next:</strong> delist these items in Nifty (delist everywhere), then mark the order handled at
<a href="https://www.foundinalabama.com/admin/tes-orders">/admin/tes-orders</a>.</p>`,
      }),
    });
  } catch (err) {
    // Notification failures must never fail the webhook.
    console.error("[tes webhook] notify failed", err);
  }
}

export async function POST(req: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const stripe = new Stripe(secretKey);
  const signature = req.headers.get("stripe-signature");
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature ?? "", webhookSecret);
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.expired"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId =
      (session.metadata?.tesOrderId as string | undefined) ??
      session.client_reference_id ??
      null;
    if (!orderId) return NextResponse.json({ received: true });

    if (event.type === "checkout.session.expired") {
      await db
        .update(tesOrders)
        .set({ status: "canceled" })
        .where(eq(tesOrders.id, orderId));
      return NextResponse.json({ received: true });
    }

    // Paid. Idempotency: only act on the pending → paid transition.
    const updated = await db
      .update(tesOrders)
      .set({
        status: "paid",
        paidAt: new Date(),
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
        email: session.customer_details?.email ?? null,
        // Shipping details moved between Stripe API versions
        // (shipping_details → collected_information.shipping_details);
        // read both shapes defensively.
        shippingName:
          (session as unknown as ShippingShapes).collected_information
            ?.shipping_details?.name ??
          (session as unknown as ShippingShapes).shipping_details?.name ??
          session.customer_details?.name ??
          null,
        shippingAddress:
          (session as unknown as ShippingShapes).collected_information
            ?.shipping_details?.address ??
          (session as unknown as ShippingShapes).shipping_details?.address ??
          session.customer_details?.address ??
          null,
      })
      .where(sql`${tesOrders.id} = ${orderId} AND ${tesOrders.status} = 'pending'`)
      .returning({ id: tesOrders.id });

    if (updated.length > 0) {
      // Decrement mirror quantities so both storefronts drop the items
      // immediately (the delta sync will confirm once Nifty ends them).
      const items = await db
        .select()
        .from(tesOrderItems)
        .where(eq(tesOrderItems.orderId, orderId));
      for (const it of items) {
        await db
          .update(ebayListings)
          .set({
            quantity: sql`GREATEST(0, COALESCE(${ebayListings.quantity}, 0) - ${it.quantity})`,
            lastSyncedAt: new Date(),
          })
          .where(eq(ebayListings.itemId, it.itemId));
      }
      await notifyTodd(orderId);
    }
  }

  return NextResponse.json({ received: true });
}
