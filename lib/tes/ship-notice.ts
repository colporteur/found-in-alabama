// "Your order has shipped" email to the buyer (SHIP-NOTICE), for orders from
// The Ephemeral State (source tes) and Found in Alabama (source fia) — sent
// from the store the order came from. Hip orders are HipPostcard's to notify.
//
//   tracking   sent when tracking is recorded (by hand or Pirate Ship import):
//              the number and a carrier link
//   stamped    sent when Todd marks the order "mailed by stamp": no tracking,
//              plus his photo of the stamped mailpiece when he took one
//              (uploaded from the TES orders page, stored in R2)
// Each order is emailed once (ship_email_sent_at); "Send again" forces it.
// The columns come from migration 0053; until it has run, nothing is sent and
// the page hides the panel (shipNoticeReady).

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { trackingUrl } from "./pirate-ship";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

/** carrier value for an order mailed with a stamp (no tracking). */
export const STAMPED = "stamp";
export const NOTICE_SOURCES = ["tes", "fia"];

export type Brand = { name: string; site: string; from: string };

export function brandFor(source: string): Brand {
  if (source === "fia") {
    return {
      name: "Found in Alabama",
      site: "https://www.foundinalabama.com",
      from: process.env.FIA_EMAIL_FROM || process.env.AUTH_EMAIL_FROM || "Found in Alabama <hello@foundinalabama.com>",
    };
  }
  return {
    name: "The Ephemeral State",
    site: "https://theephemeralstate.com",
    from: process.env.TES_EMAIL_FROM || "The Ephemeral State <orders@theephemeralstate.com>",
  };
}

let readyCache: boolean | null = null;
export async function shipNoticeReady(): Promise<boolean> {
  if (readyCache) return true;
  const [r] = await rows(sql`
    SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'tes_orders' AND column_name = 'ship_email_sent_at'`);
  readyCache = !!r;
  return readyCache;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type NoticeInput = {
  orderId: string;
  brand: Brand;
  name: string | null;
  items: string[];
  tracking: string | null;
  carrier: string | null;
  photoUrl: string | null;
};

/** Pure: subject, HTML and text of the email. */
export function shipNoticeContent(n: NoticeInput): { subject: string; html: string; text: string } {
  const first = (n.name ?? "").trim().split(/\s+/)[0] || "there";
  const ref = n.orderId.slice(0, 8).toUpperCase();
  const subject = `Your order from ${n.brand.name} has shipped`;
  const itemsText = n.items.map((t) => `- ${t}`).join("\n");
  const itemsHtml = n.items.map((t) => `<li>${esc(t)}</li>`).join("");
  let howText: string;
  let howHtml: string;
  if (n.tracking) {
    const url = trackingUrl(n.tracking, n.carrier);
    howText = `It's on its way${n.carrier ? ` by ${n.carrier}` : ""}. Tracking number: ${n.tracking}\nTrack it here: ${url}`;
    howHtml = `<p>It's on its way${n.carrier ? ` by ${esc(n.carrier)}` : ""}. Tracking number: <a href="${esc(url)}">${esc(n.tracking)}</a></p>`;
  } else {
    howText =
      "We mailed it today by First-Class Mail with a stamp, so it doesn't have a tracking number." +
      (n.photoUrl ? `\nHere's your package, stamped and ready to go: ${n.photoUrl}` : "");
    howHtml =
      "<p>We mailed it today by First-Class Mail with a stamp, so it doesn't have a tracking number.</p>" +
      (n.photoUrl
        ? `<p>Here's your package, stamped and ready to go:</p><p><img src="${esc(n.photoUrl)}" alt="Your package, stamped and ready to mail" style="max-width:100%;width:480px;border-radius:6px;border:1px solid #ddd" /></p>`
        : "");
  }
  const text = [
    `Hi ${first},`,
    "",
    `Good news — your order from ${n.brand.name} has shipped.`,
    "",
    howText,
    "",
    "In your package:",
    itemsText,
    "",
    `Order ${ref}. Questions? Just reply to this email.`,
    "",
    `Thank you for shopping with us!`,
    n.brand.name,
    n.brand.site,
  ].join("\n");
  const html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#222;max-width:560px">
<p>Hi ${esc(first)},</p>
<p>Good news — your order from <strong>${esc(n.brand.name)}</strong> has shipped.</p>
${howHtml}
<p>In your package:</p><ul>${itemsHtml}</ul>
<p style="color:#666;font-size:14px">Order ${ref}. Questions? Just reply to this email.</p>
<p>Thank you for shopping with us!<br/><a href="${esc(n.brand.site)}">${esc(n.brand.name)}</a></p>
</div>`;
  return { subject, html, text };
}

/** The address part of "Name <addr>". */
function addressOf(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from.trim();
}

async function resend(body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const apiKey = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, status: 0, error: "Resend API key not configured" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, error: `Resend HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}` };
}

export type NoticeResult = { sent: boolean; skipped?: string; error?: string; from?: string };

/** Email the buyer that their order shipped (once, unless force). */
export async function sendShipNotice(orderId: string, opts: { force?: boolean } = {}): Promise<NoticeResult> {
  if (!(await shipNoticeReady())) return { sent: false, skipped: "shipping emails aren't set up yet (migration 0053)" };
  const [o] = await rows(sql`
    SELECT id, source, status, email, shipping_name, tracking_number, carrier, shipped_at, mailpiece_photo_url, ship_email_sent_at
    FROM tes_orders WHERE id = ${orderId}::uuid`);
  if (!o) return { sent: false, skipped: "no such order" };
  const source = String(o.source);
  if (!NOTICE_SOURCES.includes(source)) return { sent: false, skipped: "HipPostcard notifies its own buyers" };
  if (String(o.status) !== "paid") return { sent: false, skipped: `order is ${String(o.status)}` };
  if (!o.email) return { sent: false, skipped: "no buyer email" };
  if (!o.shipped_at || (!o.tracking_number && o.carrier !== STAMPED)) return { sent: false, skipped: "not shipped yet" };
  if (o.ship_email_sent_at && !opts.force) return { sent: false, skipped: "already emailed" };

  const items = (await rows(sql`SELECT title, quantity FROM tes_order_items WHERE order_id = ${orderId}::uuid ORDER BY title`)).map(
    (r) => `${Number(r.quantity) > 1 ? `${Number(r.quantity)} × ` : ""}${String(r.title ?? "item")}`
  );
  const brand = brandFor(source);
  const content = shipNoticeContent({
    orderId,
    brand,
    name: (o.shipping_name as string | null) ?? null,
    items,
    tracking: (o.tracking_number as string | null) ?? null,
    carrier: o.carrier === STAMPED ? null : ((o.carrier as string | null) ?? null),
    photoUrl: (o.mailpiece_photo_url as string | null) ?? null,
  });
  const replyTo = process.env.SHIP_EMAIL_REPLY_TO || process.env.ADMIN_EMAIL;
  const base = { to: String(o.email), subject: content.subject, html: content.html, text: content.text, ...(replyTo ? { reply_to: replyTo } : {}) };
  let from = brand.from;
  let r = await resend({ ...base, from });
  // The store's own domain not verified with Resend yet: same store name,
  // sent from the address Resend already sends sign-in mail from.
  if (!r.ok && (r.status === 403 || r.status === 422) && /domain|verif/i.test(r.error) && process.env.AUTH_EMAIL_FROM) {
    from = `${brand.name} <${addressOf(process.env.AUTH_EMAIL_FROM)}>`;
    r = await resend({ ...base, from });
  }
  if (!r.ok) {
    await db.execute(sql`UPDATE tes_orders SET ship_email_error = ${r.error} WHERE id = ${orderId}::uuid`);
    return { sent: false, error: r.error };
  }
  await db.execute(sql`UPDATE tes_orders SET ship_email_sent_at = now(), ship_email_error = NULL WHERE id = ${orderId}::uuid`);
  return { sent: true, from };
}

/** Mark an order mailed by stamp (no tracking) and email the buyer. */
export async function markStamped(orderId: string): Promise<NoticeResult> {
  const done = await rows(sql`
    UPDATE tes_orders SET carrier = ${STAMPED}, tracking_number = NULL, shipped_at = COALESCE(shipped_at, now())
    WHERE id = ${orderId}::uuid AND source IN ('tes', 'fia') AND status = 'paid' AND tracking_number IS NULL
    RETURNING id`);
  if (!done.length) return { sent: false, error: "Only a paid website order without tracking can be marked mailed by stamp." };
  return sendShipNotice(orderId);
}

export async function noticeState(ids: string[]): Promise<Map<string, { photo: string | null; sentAt: string | null; error: string | null }>> {
  const out = new Map<string, { photo: string | null; sentAt: string | null; error: string | null }>();
  if (!ids.length || !(await shipNoticeReady())) return out;
  const list = await rows(sql`
    SELECT id, mailpiece_photo_url, ship_email_sent_at, ship_email_error FROM tes_orders
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  for (const r of list) {
    out.set(String(r.id), {
      photo: (r.mailpiece_photo_url as string | null) ?? null,
      sentAt: r.ship_email_sent_at ? new Date(String(r.ship_email_sent_at)).toISOString() : null,
      error: (r.ship_email_error as string | null) ?? null,
    });
  }
  return out;
}
