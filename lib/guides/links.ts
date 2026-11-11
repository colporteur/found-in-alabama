// Expert Guide learning loop (Phase 5c): filing every sold and live item under
// the Expert Guide that covers it.
//
// Two passes. The keyword linker (free, here) scores each item's title, eBay
// category, store shelf and the guide its listing was written with, and files
// the clear ones. What it is unsure of — a single loose word, a shelf with no
// word to back it, two branches of the library in a near tie — stays marked
// "not confident" for Claude (through the connector) or Todd to settle. A
// decision by Claude or Todd is never overwritten by the linker.

import { db } from "@/db";
import { sql, type SQL } from "drizzle-orm";
import { clearGuideCache, listGuides, type GuideMeta } from "@/lib/enhance/guides";
import { buildLinker, linkable, type LinkGuide } from "./score";

type Row = Record<string, unknown>;
async function rows(q: SQL): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}
function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const asLinkGuide = (g: GuideMeta): LinkGuide => ({
  id: g.id, family: g.family, parent: g.parent, stage: g.stage, priority: g.priority,
  keywords: g.keywords, ebayCategoryIds: g.ebayCategoryIds ?? [], storeCategories: g.storeCategories ?? [],
});

/** The guides an item can be filed under (no buy-side guides, playbooks or decoders). */
export async function linkableGuides(fresh = false): Promise<GuideMeta[]> {
  if (fresh) clearGuideCache();
  return (await listGuides()).filter((g) => linkable(asLinkGuide(g)));
}

const ITEM_FIELDS = sql`
  r.id, r.title, r.status, el.site_category_id AS site_cat, sc.name AS shelf,
  (SELECT jsonb_path_query_array(d.ai_meta->'guides', '$[*].id') FROM listing_drafts d
    WHERE d.registry_item_id = r.id AND jsonb_typeof(d.ai_meta->'guides') = 'array'
    ORDER BY d.updated_at DESC LIMIT 1) AS draft_guides`;
const ITEM_JOINS = sql`
  LEFT JOIN items it ON it.id = r.nifty_item_ref
  LEFT JOIN ebay_listings el ON el.item_id = r.primary_ebay_item_id
  LEFT JOIN ebay_store_categories sc ON sc.category_id = COALESCE(el.store_category_1_id, it.ebay_store_category_id)`;

export type LinkRun = { scored: number; confident: number; forReview: number; noGuide: number; remaining: number; guides: number };

/**
 * One batch of the keyword linker. New items (no row yet) always; with
 * `rescoreBefore`, also the linker's own earlier guesses last touched before
 * that moment — for after a guide is added or its keywords change. Call again
 * while `remaining` > 0.
 */
export async function runLinker(opts: { limit?: number; rescoreBefore?: Date | null } = {}): Promise<LinkRun> {
  const limit = Math.min(5000, Math.max(1, opts.limit ?? 3000));
  const guides = await linkableGuides(!!opts.rescoreBefore);
  if (!guides.length) throw new Error("The guide library is empty or unreachable, so nothing was linked.");
  const linker = buildLinker(guides.map(asLinkGuide));
  const before = opts.rescoreBefore ? opts.rescoreBefore.toISOString() : null;
  const need = before
    ? sql`(l.registry_item_id IS NULL OR (l.method = 'keyword' AND l.updated_at < ${before}::timestamp))`
    : sql`l.registry_item_id IS NULL`;

  const items = await rows(sql`
    SELECT ${ITEM_FIELDS}
    FROM registry_items r ${ITEM_JOINS}
    LEFT JOIN item_guide_links l ON l.registry_item_id = r.id
    WHERE r.status IN ('live', 'sold') AND ${need}
    ORDER BY r.id LIMIT ${limit}`);

  let confident = 0, forReview = 0, noGuide = 0;
  const out = items.map((it) => {
    const raw = typeof it.draft_guides === "string" ? safeJson(it.draft_guides) : it.draft_guides;
    const drafted = Array.isArray(raw) ? raw.map(String).filter((id) => linker.guideIds.has(id)) : [];
    const r = linker.score({
      title: String(it.title ?? ""),
      siteCategoryId: it.site_cat ? String(it.site_cat) : null,
      storeCategory: it.shelf ? String(it.shelf) : null,
      draftGuideIds: drafted,
    });
    if (!r.guideId) noGuide++; else if (r.confident) confident++; else forReview++;
    return { id: String(it.id), guide: r.guideId, score: r.score, alt: r.altGuideId, confident: r.confident };
  });

  if (out.length) {
    await db.execute(sql`
      INSERT INTO item_guide_links (registry_item_id, guide_id, method, score, alt_guide_id, confident, linked_by, updated_at)
      SELECT x.id::uuid, x.guide, 'keyword', x.score, x.alt, x.confident, 'linker', now()
      FROM jsonb_to_recordset(${JSON.stringify(out)}::jsonb) AS x(id text, guide text, score int, alt text, confident boolean)
      ON CONFLICT (registry_item_id) DO UPDATE
        SET guide_id = EXCLUDED.guide_id, score = EXCLUDED.score, alt_guide_id = EXCLUDED.alt_guide_id,
            confident = EXCLUDED.confident, linked_by = 'linker', updated_at = now()
        WHERE item_guide_links.method = 'keyword'`);
  }
  const [left] = await rows(sql`
    SELECT count(*)::int AS n FROM registry_items r
    LEFT JOIN item_guide_links l ON l.registry_item_id = r.id
    WHERE r.status IN ('live', 'sold') AND ${need}`);
  return { scored: out.length, confident, forReview, noGuide, remaining: Number(left?.n ?? 0), guides: guides.length };
}

/** Run batches until nothing is left or the time budget is spent. */
export async function runLinkerUntilDone(opts: { rescore?: boolean; budgetMs?: number } = {}): Promise<LinkRun & { batches: number }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  const rescoreBefore = opts.rescore ? new Date() : null;
  const total: LinkRun & { batches: number } = { scored: 0, confident: 0, forReview: 0, noGuide: 0, remaining: 0, guides: 0, batches: 0 };
  do {
    const r = await runLinker({ rescoreBefore });
    total.scored += r.scored; total.confident += r.confident; total.forReview += r.forReview; total.noGuide += r.noGuide;
    total.remaining = r.remaining; total.guides = r.guides; total.batches++;
    if (!r.scored) break;
  } while (total.remaining > 0 && Date.now() - started < budget);
  return total;
}

export type QueueKind = "review" | "unmatched";

/**
 * Items waiting for a decision. "review" = the linker found a guide but is not
 * sure (the useful pile); "unmatched" = no guide word at all (mostly things no
 * guide covers). Sold items first, since those feed "your results".
 */
export async function linkQueue(opts: { kind?: QueueKind; status?: "sold" | "live" | "any"; guideId?: string | null; shelf?: string | null; limit?: number }) {
  const kind = opts.kind ?? "review";
  const limit = Math.min(150, Math.max(1, opts.limit ?? 60));
  const status = opts.status ?? "any";
  const where: SQL[] = [sql`l.method = 'keyword'`, sql`l.confident = false`, sql`r.status IN ('live', 'sold')`];
  where.push(kind === "review" ? sql`l.guide_id IS NOT NULL` : sql`l.guide_id IS NULL`);
  if (status !== "any") where.push(sql`r.status = ${status}`);
  if (opts.guideId) where.push(sql`(l.guide_id = ${opts.guideId} OR l.alt_guide_id = ${opts.guideId})`);
  if (opts.shelf) where.push(sql`sc.name = ${opts.shelf}`);
  const cond = sql.join(where, sql` AND `);
  const list = await rows(sql`
    SELECT r.id, r.title, r.status, sc.name AS shelf, el.site_category_name AS ebay_category,
           l.guide_id, l.score, l.alt_guide_id
    FROM item_guide_links l JOIN registry_items r ON r.id = l.registry_item_id ${ITEM_JOINS}
    WHERE ${cond}
    ORDER BY (r.status = 'sold') DESC, l.score DESC, r.sold_at DESC NULLS LAST, r.id LIMIT ${limit}`);
  const [counts] = await rows(sql`
    SELECT count(*) FILTER (WHERE l.guide_id IS NOT NULL AND r.status = 'sold')::int AS review_sold,
           count(*) FILTER (WHERE l.guide_id IS NOT NULL AND r.status = 'live')::int AS review_live,
           count(*) FILTER (WHERE l.guide_id IS NULL AND r.status = 'sold')::int AS unmatched_sold,
           count(*) FILTER (WHERE l.guide_id IS NULL AND r.status = 'live')::int AS unmatched_live
    FROM item_guide_links l JOIN registry_items r ON r.id = l.registry_item_id
    WHERE l.method = 'keyword' AND l.confident = false AND r.status IN ('live', 'sold')`);
  return {
    waiting: counts ?? {},
    items: list.map((r) => ({
      id: String(r.id), title: String(r.title ?? ""), status: String(r.status),
      shelf: (r.shelf as string | null) ?? null, ebayCategory: (r.ebay_category as string | null) ?? null,
      suggested: (r.guide_id as string | null) ?? null, score: Number(r.score ?? 0),
      alternative: (r.alt_guide_id as string | null) ?? null,
    })),
  };
}

/** The undecided pile grouped by store shelf — lets one decision settle a whole shelf. */
export async function linkQueueShelves(kind: QueueKind = "unmatched") {
  const guideCond = kind === "review" ? sql`l.guide_id IS NOT NULL` : sql`l.guide_id IS NULL`;
  const list = await rows(sql`
    SELECT COALESCE(sc.name, '(no shelf)') AS shelf, count(*)::int AS items,
           count(*) FILTER (WHERE r.status = 'sold')::int AS sold,
           (array_agg(r.title ORDER BY r.sold_at DESC NULLS LAST))[1:3] AS examples
    FROM item_guide_links l JOIN registry_items r ON r.id = l.registry_item_id ${ITEM_JOINS}
    WHERE l.method = 'keyword' AND l.confident = false AND ${guideCond} AND r.status IN ('live', 'sold')
    GROUP BY 1 ORDER BY 2 DESC LIMIT 200`);
  return list.map((r) => ({ shelf: String(r.shelf), items: Number(r.items), sold: Number(r.sold), examples: (r.examples as string[] | null) ?? [] }));
}

export type LinkDecision = { itemId: string; guideId: string | null };

/** Record decisions (guideId null = "no guide covers this item"). */
export async function saveLinks(decisions: LinkDecision[], who: string, method: "claude" | "manual" = "claude") {
  const valid = new Set((await linkableGuides()).map((g) => g.id));
  const good: Array<{ id: string; guide: string | null }> = [];
  const rejected: Array<{ itemId: string; why: string }> = [];
  for (const d of decisions.slice(0, 300)) {
    if (!UUID.test(d.itemId)) rejected.push({ itemId: d.itemId, why: "not an item id" });
    else if (d.guideId !== null && !valid.has(d.guideId)) rejected.push({ itemId: d.itemId, why: `no guide "${d.guideId}" that items can be filed under` });
    else good.push({ id: d.itemId, guide: d.guideId });
  }
  let saved = 0;
  if (good.length) {
    const res = await rows(sql`
      INSERT INTO item_guide_links (registry_item_id, guide_id, method, score, alt_guide_id, confident, linked_by, updated_at)
      SELECT r.id, x.guide, ${method}, 0, NULL, true, ${who}, now()
      FROM jsonb_to_recordset(${JSON.stringify(good)}::jsonb) AS x(id text, guide text)
      JOIN registry_items r ON r.id = x.id::uuid
      ON CONFLICT (registry_item_id) DO UPDATE
        SET guide_id = EXCLUDED.guide_id, method = EXCLUDED.method, confident = true,
            alt_guide_id = NULL, linked_by = EXCLUDED.linked_by, updated_at = now()
      RETURNING registry_item_id`);
    saved = res.length;
  }
  return { saved, rejected };
}

/** Settle every undecided item on one store shelf at once (guideId null = no guide). */
export async function saveShelf(shelf: string, guideId: string | null, kind: QueueKind, who: string) {
  if (guideId !== null && !(await linkableGuides()).some((g) => g.id === guideId)) throw new Error(`No guide "${guideId}" that items can be filed under`);
  const guideCond = kind === "review" ? sql`l.guide_id IS NOT NULL` : sql`l.guide_id IS NULL`;
  if (!shelf || shelf === "(no shelf)") throw new Error("Items with no shelf have nothing in common; decide those item by item.");
  const shelfCond = sql`sc.name = ${shelf}`;
  const res = await rows(sql`
    UPDATE item_guide_links l
    SET guide_id = ${guideId}, method = 'claude', confident = true, alt_guide_id = NULL, linked_by = ${who}, updated_at = now()
    FROM registry_items r ${ITEM_JOINS}
    WHERE r.id = l.registry_item_id AND l.method = 'keyword' AND l.confident = false AND ${guideCond}
      AND r.status IN ('live', 'sold') AND ${shelfCond}
    RETURNING l.registry_item_id`);
  return { saved: res.length };
}
