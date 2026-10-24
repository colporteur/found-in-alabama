// Direct-to-eBay publishing: the switches and which drafts take that road.
//
// app_settings "ebay_publish" = { enabled, cardsDirect }
//   enabled      the "Publish to eBay" panel on every approved draft (pilot).
//   cardsDirect  single trading cards skip Nifty and go straight to eBay
//                (default ON: Nifty can't send the card condition eBay
//                requires for single cards, so they fail there).
// A draft's own choice (ai_meta.publishRoute = "ebay" | "nifty") wins over
// the default. "Send approved to Nifty" leaves eBay-road drafts alone.
// Kept apart from publish.ts so lib/listings/nifty.ts can use it.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { CARD_SINGLE_CATEGORIES, isCardSingle } from "./publish-core";

const KEY = "ebay_publish";

export type EbaySettings = { enabled: boolean; cardsDirect: boolean };
export type PublishRoute = "ebay" | "nifty";

export async function ebaySettings(): Promise<EbaySettings> {
  const res = (await db.execute(sql`SELECT value FROM app_settings WHERE key = ${KEY}`)) as { rows?: Array<{ value?: unknown }> };
  const v = (res.rows?.[0]?.value ?? {}) as { enabled?: boolean; cardsDirect?: boolean };
  return { enabled: v.enabled === true, cardsDirect: v.cardsDirect !== false };
}

export async function saveEbaySettings(patch: Partial<EbaySettings>): Promise<EbaySettings> {
  const clean: Partial<EbaySettings> = {};
  if (typeof patch.enabled === "boolean") clean.enabled = patch.enabled;
  if (typeof patch.cardsDirect === "boolean") clean.cardsDirect = patch.cardsDirect;
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify(clean)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = app_settings.value || EXCLUDED.value, updated_at = now()`);
  return ebaySettings();
}

/** Pure: which road one draft takes. */
export function draftRoute(s: EbaySettings, categoryId: string | null | undefined, meta: Record<string, unknown> | null | undefined): PublishRoute {
  const own = meta?.publishRoute;
  if (own === "ebay" && (s.enabled || isCardSingle(categoryId))) return "ebay";
  if (own === "nifty") return "nifty";
  return s.cardsDirect && isCardSingle(categoryId) ? "ebay" : "nifty";
}

/** SQL: listing_drafts row `d` takes the eBay road (mirror of draftRoute). */
export function ebayRoadSql(s: EbaySettings) {
  const cards = sql`COALESCE(d.ebay_category_id, '') IN (${sql.join(CARD_SINGLE_CATEGORIES.map((c) => sql`${c}`), sql`, `)})`;
  const own = sql`(d.ai_meta->>'publishRoute')`;
  // COALESCE: a NULL anywhere must read as "not eBay", never drop the row.
  return sql`COALESCE((
    (${own} = 'ebay' AND (${sql.raw(s.enabled ? "true" : "false")} OR ${cards}))
    OR (${own} IS DISTINCT FROM 'nifty' AND ${own} IS DISTINCT FROM 'ebay' AND ${sql.raw(s.cardsDirect ? "true" : "false")} AND ${cards})
  ), false)`;
}
