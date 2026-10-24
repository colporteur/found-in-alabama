// SHIP-2: which live eBay listings could ship eBay Standard Envelope but
// don't, and a summary of how the sites can mail things. Read-only; the
// switch itself is a "shipping_policy" Expert Enhance batch Todd starts
// from /admin/shipping (rollback per item or per batch).
//
// A candidate is a live listing that:
//   - isn't on a Standard Envelope policy already,
//   - is priced $20 or less (eBay's cap),
//   - sits in a category on eBay's eligible list (lib/enhance/ese.ts, from
//     eBay's own spreadsheet), and
//   - fits the envelope by FIA's measurements (ebay_listings.mail_se_fit:
//     measured, sized in the title, or a standard format like a postcard
//     or trading card — and within eBay's piece limits).

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { eseEligible, eseList } from "@/lib/enhance/ese";
import { MAIL_MAX_PRICE } from "./mail";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export type EnvelopeCandidate = {
  itemId: string;
  title: string;
  price: number;
  category: string;
  size: string | null;
  sizeSource: string | null;
  policy: string | null;
};

const ENVELOPE_SQL = sql`(COALESCE(e.shipping_services::text, '') ILIKE '%StandardEnvelope%' OR COALESCE(e.shipping_profile_name, '') ILIKE '%standard envelope%')`;

export async function envelopeCandidates(): Promise<EnvelopeCandidate[]> {
  const found = await rows(sql`
    SELECT e.item_id, e.title, e.price, e.site_category_name, e.mail_size, e.mail_size_source, e.shipping_profile_name
    FROM ebay_listings e
    WHERE e.quantity > 0 AND e.price <= ${MAIL_MAX_PRICE} AND e.mail_se_fit = true AND NOT ${ENVELOPE_SQL}
    ORDER BY e.site_category_name, e.price`);
  const list = eseList();
  return found
    .filter((r) => eseEligible(String(r.site_category_name ?? ""), list))
    .map((r) => ({
      itemId: String(r.item_id),
      title: String(r.title ?? "").replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"'),
      price: Number(r.price),
      category: String(r.site_category_name ?? "").replace(/&amp;/g, "&").split(":").slice(-2).join(" › "),
      size: (r.mail_size as string | null) ?? null,
      sizeSource: (r.mail_size_source as string | null) ?? null,
      policy: ((r.shipping_profile_name as string | null) ?? "").replace(/&amp;/g, "&") || null,
    }));
}

export type MailOverview = {
  checkedAt: string | null;
  onEnvelope: number;
  stampOk: number;
  stampOkNotEnvelope: number;
  paperNoSize: number;
};

export async function mailOverview(): Promise<MailOverview> {
  const [r] = await rows(sql`
    SELECT max(e.mail_checked_at) AS checked,
           count(*) FILTER (WHERE ${ENVELOPE_SQL}) AS on_env,
           count(*) FILTER (WHERE e.stamp_ok) AS stamp_ok,
           count(*) FILTER (WHERE e.stamp_ok AND NOT ${ENVELOPE_SQL}) AS stamp_only,
           count(*) FILTER (WHERE e.mail_size IS NULL AND e.price <= ${MAIL_MAX_PRICE} AND NOT ${ENVELOPE_SQL}
             AND e.site_category_name ~* 'photograph|postcard|ephemera|greeting card|sheet music|paper|trade card') AS no_size
    FROM ebay_listings e WHERE e.quantity > 0`);
  return {
    checkedAt: r?.checked ? new Date(String(r.checked)).toISOString() : null,
    onEnvelope: Number(r?.on_env ?? 0),
    stampOk: Number(r?.stamp_ok ?? 0),
    stampOkNotEnvelope: Number(r?.stamp_only ?? 0),
    paperNoSize: Number(r?.no_size ?? 0),
  };
}
