// SHIP-2: keep ebay_listings' mail facts (mail.ts) current. Runs with the
// search-index cron; rewrites only rows whose facts changed.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { mailFacts, sizeText } from "./mail";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export async function mailFactsReady(): Promise<boolean> {
  const [r] = await rows(sql`
    SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'ebay_listings' AND column_name = 'stamp_ok'`);
  return !!r;
}

/** A size item specific ("Size", "Item Length"…) as text, if any. */
function specificSize(spec: unknown): string | null {
  if (!spec || typeof spec !== "object") return null;
  const s = spec as Record<string, unknown>;
  const one = (k: string) => {
    const v = s[k];
    return (Array.isArray(v) ? v[0] : v)?.toString() ?? "";
  };
  for (const k of ["Size", "Dimensions", "Item Size", "Image Size", "Paper Size"]) if (/\d\s*[x×]\s*\d/.test(one(k))) return one(k);
  const l = parseFloat(one("Item Length"));
  const w = parseFloat(one("Item Width"));
  return l > 0 && w > 0 ? `${l}x${w}` : null;
}

export async function refreshMailFacts(): Promise<{ checked: number; changed: number; stampOk: number }> {
  // FIA's own measurements, by eBay item id.
  const drafts = await rows(sql`
    SELECT COALESCE(ai_meta->>'ebayItemId', ai_meta->'ebayPublish'->>'itemId') AS item_id,
           facts->>'size_inches' AS size, item_specifics, ai_meta->'identification'->>'kind' AS kind
    FROM listing_drafts
    WHERE status = 'published' AND COALESCE(ai_meta->>'ebayItemId', ai_meta->'ebayPublish'->>'itemId') IS NOT NULL`);
  const byItem = new Map<string, { measured: string | null; kind: string | null }>();
  for (const d of drafts) {
    byItem.set(String(d.item_id), {
      measured: (d.size as string | null) || specificSize(d.item_specifics),
      kind: (d.kind as string | null) ?? null,
    });
  }

  const live = await rows(sql`
    SELECT item_id, title, site_category_id, site_category_name, price, mail_size, mail_size_source, mail_se_fit, stamp_ok
    FROM ebay_listings WHERE quantity > 0`);
  const changes: Array<{ id: string; size: string | null; source: string | null; se: boolean | null; stamp: boolean }> = [];
  let stampOk = 0;
  for (const r of live) {
    const id = String(r.item_id);
    const d = byItem.get(id);
    const f = mailFacts({
      title: String(r.title ?? ""),
      categoryId: (r.site_category_id as string | null) ?? null,
      categoryName: (r.site_category_name as string | null) ?? null,
      price: r.price != null ? Number(r.price) : null,
      kind: d?.kind ?? null,
      measured: d?.measured ?? null,
    });
    if (f.stampOk) stampOk++;
    const size = sizeText(f.size);
    const source = f.size?.source ?? null;
    if (size !== (r.mail_size ?? null) || source !== (r.mail_size_source ?? null) || f.seFit !== (r.mail_se_fit ?? null) || f.stampOk !== (r.stamp_ok ?? null)) {
      changes.push({ id, size, source, se: f.seFit, stamp: f.stampOk });
    }
  }
  for (let i = 0; i < changes.length; i += 500) {
    const part = changes.slice(i, i + 500);
    await db.execute(sql`
      UPDATE ebay_listings e SET mail_size = v.size, mail_size_source = v.source, mail_se_fit = v.se::boolean,
        stamp_ok = v.stamp::boolean, mail_checked_at = now()
      FROM (VALUES ${sql.join(
        part.map((c) => sql`(${c.id}, ${c.size}, ${c.source}, ${c.se === null ? null : String(c.se)}, ${String(c.stamp)})`),
        sql`, `
      )}) AS v(id, size, source, se, stamp)
      WHERE e.item_id = v.id`);
  }
  return { checked: live.length, changed: changes.length, stampOk };
}
