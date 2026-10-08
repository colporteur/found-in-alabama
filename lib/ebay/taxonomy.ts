// eBay Taxonomy API: the item specifics ("aspects") each eBay category
// accepts — names, required / recommended, free text vs. pick-from-list,
// single vs. multiple values, and the allowed values.
//
// Uses an APPLICATION token (client-credentials grant with EBAY_APP_ID +
// EBAY_CERT_ID, scope api_scope) — no user consent needed. Aspects change
// rarely, so they're cached in ebay_category_aspects for 30 days.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { parseAspects, type CategoryAspect } from "./aspects";

export type { CategoryAspect } from "./aspects";

const CACHE_DAYS = 30;

let appToken: { token: string; exp: number } | null = null;

function apiHost(): string {
  return (process.env.EBAY_ENV ?? "production") === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

async function applicationToken(): Promise<string> {
  if (appToken && appToken.exp - 120_000 > Date.now()) return appToken.token;
  const id = process.env.EBAY_APP_ID;
  const secret = process.env.EBAY_CERT_ID;
  if (!id || !secret) throw new Error("EBAY_APP_ID / EBAY_CERT_ID are not set");
  const res = await fetch(`${apiHost()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) throw new Error(`eBay app token HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  appToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 7200) * 1000 };
  return appToken.token;
}

async function fetchAspects(categoryId: string): Promise<CategoryAspect[]> {
  const token = await applicationToken();
  const res = await fetch(
    `${apiHost()}/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    { headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "gzip" }, signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) throw new Error(`eBay aspects HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseAspects(await res.json());
}

type Row = Record<string, unknown>;

/** Aspects for an eBay (leaf) category, from cache or eBay. Null when eBay
 *  can't be reached — the writer then keeps its own specifics. */
export async function categoryAspects(categoryId: string): Promise<CategoryAspect[] | null> {
  if (!/^\d{1,12}$/.test(categoryId)) return null;
  try {
    const res = (await db.execute(sql`
      SELECT aspects FROM ebay_category_aspects
      WHERE category_id = ${categoryId} AND fetched_at > now() - make_interval(days => ${CACHE_DAYS})`)) as { rows?: Row[] };
    const hit = res.rows?.[0]?.aspects;
    if (Array.isArray(hit)) return hit as CategoryAspect[];
  } catch {
    // table missing (migration not run yet) — fall through to eBay
  }
  try {
    const aspects = await fetchAspects(categoryId);
    await db
      .execute(sql`
        INSERT INTO ebay_category_aspects (category_id, aspects, fetched_at)
        VALUES (${categoryId}, ${JSON.stringify(aspects)}::jsonb, now())
        ON CONFLICT (category_id) DO UPDATE SET aspects = EXCLUDED.aspects, fetched_at = now()`)
      .catch(() => undefined);
    return aspects;
  } catch (err) {
    console.error("[taxonomy] aspects failed for", categoryId, err);
    return null;
  }
}
