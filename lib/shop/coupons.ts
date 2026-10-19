// Invoice coupon codes (COUPON-1). Every package's invoice can carry a code
// good for one order on foundinalabama.com or theephemeralstate.com. Both
// sites check out through the same Stripe account, so the code is a Stripe
// promotion code: Stripe shows the "Add promotion code" box at checkout,
// checks the expiry, and allows one use. Items only — Stripe coupons don't
// discount the shipping line.
//
// Nothing to set up: the code is made the first time the invoice is shown
// (and kept, so a reprint shows the same code). The percent, lifetime and
// which venues' invoices get one live in app_settings 'coupons' (Ship →
// Coupons). The webhook records which order used a code.

import { randomInt } from "node:crypto";
import Stripe from "stripe";
import { db } from "@/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
// Timestamps are stored as UTC without a zone; read them back as UTC.
const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : /Z$|[+-]\d\d:?\d\d$/.test(String(v)) ? new Date(String(v)).toISOString() : new Date(`${String(v).replace(" ", "T")}Z`).toISOString();
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export const COUPON_VENUES = ["ebay", "mercari", "poshmark", "depop", "whatnot", "hip", "tes", "fia"] as const;

export type CouponSettings = {
  enabled: boolean;
  percent: number;
  days: number;
  /** Which venues' invoices get a code. */
  venues: Record<string, boolean>;
  /** COUPON-2: the "N postcards in stock" line, and its minimum count. */
  stockLine: boolean;
  stockMin: number;
  /** A QR code to the shelf on the site (with the code filled in). */
  qr: boolean;
};

export const DEFAULT_COUPON_SETTINGS: CouponSettings = {
  enabled: true,
  percent: 20,
  days: 30,
  venues: Object.fromEntries(COUPON_VENUES.map((v) => [v, true])),
  stockLine: true,
  stockMin: 25,
  qr: true,
};

/** Pure: clean settings from storage or the settings form. */
export function parseCouponSettings(raw: unknown): CouponSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const venues = { ...DEFAULT_COUPON_SETTINGS.venues };
  const rv = r.venues && typeof r.venues === "object" ? (r.venues as Record<string, unknown>) : {};
  for (const v of COUPON_VENUES) if (typeof rv[v] === "boolean") venues[v] = rv[v] as boolean;
  return {
    enabled: r.enabled !== false,
    percent: Math.round(num(r.percent, DEFAULT_COUPON_SETTINGS.percent, 1, 90) * 100) / 100,
    days: Math.round(num(r.days, DEFAULT_COUPON_SETTINGS.days, 1, 365)),
    venues,
    stockLine: r.stockLine !== false,
    stockMin: Math.round(num(r.stockMin, DEFAULT_COUPON_SETTINGS.stockMin, 1, 100000)),
    qr: r.qr !== false,
  };
}

export async function couponSettings(): Promise<CouponSettings> {
  const [r] = await rows(sql`SELECT value FROM app_settings WHERE key = 'coupons'`);
  return parseCouponSettings(r?.value ?? null);
}

export async function saveCouponSettings(raw: unknown): Promise<CouponSettings> {
  const s = parseCouponSettings(raw);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('coupons', ${JSON.stringify(s)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  return s;
}

export async function couponsReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.coupon_codes') IS NOT NULL AS ok`);
  return !!r?.ok && !!process.env.STRIPE_SECRET_KEY;
}

// Letters and digits only (Stripe's rule), no look-alikes (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Pure: a printable code like FIA7K3QX9 (TES… for Ephemeral State buyers). */
export function newCode(len = 6, prefix: "FIA" | "TES" = "FIA"): string {
  let s = prefix;
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** The Stripe coupon for a percent (one per rate, reused by every code). */
async function stripeCouponFor(stripe: Stripe, percent: number): Promise<string> {
  const id = `fia-invoice-${String(percent).replace(".", "_")}pct`;
  try {
    await stripe.coupons.retrieve(id);
  } catch {
    await stripe.coupons.create({ id, percent_off: percent, duration: "once", name: `${percent}% off (invoice code)` });
  }
  return id;
}

export type IssuedCode = { code: string; percent: number; expiresAt: string; site: "fia" | "tes" | null };

/** The code for each package (made now if it has none). Packages whose venue
 *  is switched off get none. Never throws: a Stripe hiccup just means no
 *  code on that invoice. */
export async function codesForOrders(orders: Array<{ id: string; venue: string; site?: "fia" | "tes" }>): Promise<Map<string, IssuedCode>> {
  const out = new Map<string, IssuedCode>();
  if (!orders.length || !(await couponsReady().catch(() => false))) return out;
  const s = await couponSettings();
  if (!s.enabled) return out;
  const [sc] = await rows(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'coupon_codes' AND column_name = 'site'`);
  const siteCol = Number(sc?.n ?? 0) === 1;
  const siteOf = (code: string): "fia" | "tes" => (code.startsWith("TES") ? "tes" : "fia");
  const have = await rows(sql`
    SELECT ship_order_id, code, percent, expires_at FROM coupon_codes
    WHERE ship_order_id IN (${sql.join(orders.map((o) => sql`${o.id}::uuid`), sql`, `)})`);
  for (const h of have) {
    out.set(String(h.ship_order_id), { code: String(h.code), percent: Number(h.percent), expiresAt: iso(h.expires_at), site: siteOf(String(h.code)) });
  }
  const need = orders.filter((o) => !out.has(o.id) && s.venues[o.venue] !== false);
  if (!need.length) return out;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  let couponId: string;
  try {
    couponId = await stripeCouponFor(stripe, s.percent);
  } catch (err) {
    console.error("[coupons] Stripe coupon failed", err);
    return out;
  }
  const expires = new Date(Date.now() + s.days * 86_400_000);
  const issueOne = async (o: { id: string; venue: string; site?: "fia" | "tes" }) => {
    const site = o.site ?? (o.venue === "tes" ? "tes" : "fia");
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = newCode(6, site === "tes" ? "TES" : "FIA");
      try {
        const promo = await stripe.promotionCodes.create({
          coupon: couponId,
          code,
          max_redemptions: 1,
          expires_at: Math.floor(expires.getTime() / 1000),
          metadata: { shipOrderId: o.id, venue: o.venue, site },
        });
        const saved = siteCol
          ? await rows(sql`
              INSERT INTO coupon_codes (code, percent, ship_order_id, venue, site, expires_at, stripe_coupon_id, stripe_promo_id)
              VALUES (${code}, ${s.percent}::numeric, ${o.id}::uuid, ${o.venue}, ${site}, ${expires.toISOString()}::timestamptz, ${couponId}, ${promo.id})
              ON CONFLICT (ship_order_id) DO NOTHING RETURNING code`)
          : await rows(sql`
              INSERT INTO coupon_codes (code, percent, ship_order_id, venue, expires_at, stripe_coupon_id, stripe_promo_id)
              VALUES (${code}, ${s.percent}::numeric, ${o.id}::uuid, ${o.venue}, ${expires.toISOString()}::timestamptz, ${couponId}, ${promo.id})
              ON CONFLICT (ship_order_id) DO NOTHING RETURNING code`);
        if (!saved.length) {
          // Another tab made one at the same moment: use that one, retire ours.
          await stripe.promotionCodes.update(promo.id, { active: false }).catch(() => {});
          const [h] = await rows(sql`SELECT code, percent, expires_at FROM coupon_codes WHERE ship_order_id = ${o.id}::uuid`);
          if (h) out.set(o.id, { code: String(h.code), percent: Number(h.percent), expiresAt: iso(h.expires_at), site: siteOf(String(h.code)) });
        } else {
          out.set(o.id, { code, percent: s.percent, expiresAt: expires.toISOString(), site });
        }
        return;
      } catch (err) {
        // The random code already exists in Stripe: try another. Anything else: no code on this invoice.
        const e = err as { code?: string; message?: string };
        if (!(e.code === "resource_already_exists" || /already exists/i.test(e.message ?? "")) || attempt === 2) {
          console.error("[coupons] promotion code failed", o.id, err);
          return;
        }
      }
    }
  };
  // A few at a time, so a big invoice batch doesn't take long.
  for (let i = 0; i < need.length; i += 5) await Promise.all(need.slice(i, i + 5).map(issueOne));
  return out;
}

/** Webhook: a paid checkout that used a code — record it on the order and
 *  the code (Stripe has already enforced one use and the expiry). */
export async function recordRedemption(stripe: Stripe, sessionId: string, orderId: string): Promise<void> {
  const full = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["discounts.promotion_code"] });
  const off = (full.total_details?.amount_discount ?? 0) / 100;
  if (!(off > 0)) return;
  const promo = full.discounts?.map((d) => d.promotion_code).find((p) => p && typeof p === "object") as Stripe.PromotionCode | undefined;
  const code = promo?.code ?? null;
  await db.execute(sql`
    UPDATE tes_orders SET discount = ${off}::numeric, coupon_code = ${code},
      total = ${((full.amount_total ?? 0) / 100).toFixed(2)}::numeric
    WHERE id = ${orderId}::uuid`);
  if (code) {
    await db.execute(sql`
      UPDATE coupon_codes SET redeemed_at = now(), redeemed_order_id = ${orderId}::uuid
      WHERE upper(code) = upper(${code}) AND redeemed_at IS NULL`);
  }
}

export async function recentCodes(limit = 100) {
  const list = await rows(sql`
    SELECT c.code, c.percent, c.venue, c.issued_at, c.expires_at, c.redeemed_at, o.buyer_name, o.buyer_username,
           t.total AS redeemed_total, t.discount AS redeemed_discount
    FROM coupon_codes c
    LEFT JOIN ship_orders o ON o.id = c.ship_order_id
    LEFT JOIN tes_orders t ON t.id = c.redeemed_order_id
    ORDER BY c.issued_at DESC LIMIT ${limit}`);
  const [stats] = await rows(sql`
    SELECT count(*)::int AS issued, count(redeemed_at)::int AS used,
           COALESCE(sum(t.total), 0)::numeric AS sales, COALESCE(sum(t.discount), 0)::numeric AS discounts
    FROM coupon_codes c LEFT JOIN tes_orders t ON t.id = c.redeemed_order_id`);
  return {
    stats: { issued: Number(stats?.issued ?? 0), used: Number(stats?.used ?? 0), sales: Number(stats?.sales ?? 0), discounts: Number(stats?.discounts ?? 0) },
    codes: list.map((c) => ({
      code: String(c.code),
      percent: Number(c.percent),
      venue: (c.venue as string | null) ?? null,
      buyer: (c.buyer_username as string | null) ? `@${c.buyer_username}` : ((c.buyer_name as string | null) ?? null),
      issuedAt: iso(c.issued_at),
      expiresAt: iso(c.expires_at),
      redeemedAt: c.redeemed_at ? iso(c.redeemed_at) : null,
      redeemedTotal: c.redeemed_total == null ? null : Number(c.redeemed_total),
    })),
  };
}

// ─── a code carried in from an invoice QR (?code=…) ─────────────────────────

/** Cookie the middleware sets from ?code=… (both sites; 30 days). */
export const PROMO_COOKIE = "fia_code";
/** Pure: a code as typed/scanned, or null if it can't be one of ours. */
export function cleanCode(raw: string | null | undefined): string | null {
  const c = String(raw ?? "").trim().toUpperCase();
  return /^(FIA|TES)[A-Z0-9]{4,12}$/.test(c) ? c : null;
}

/** Checkout: the Stripe promotion code id for a carried-in code, if it's
 *  still good (active, not expired, not used). Otherwise null, and the
 *  buyer can still type a code at checkout. */
export async function promoForCheckout(stripe: Stripe, raw: string | null | undefined): Promise<string | null> {
  const code = cleanCode(raw);
  if (!code) return null;
  try {
    const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
    const p = list.data[0];
    if (!p) return null;
    if (p.expires_at && p.expires_at * 1000 < Date.now()) return null;
    if (p.max_redemptions != null && p.times_redeemed >= p.max_redemptions) return null;
    return p.id;
  } catch {
    return null;
  }
}
